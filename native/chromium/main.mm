// Wing's original AppKit host for the qualified Chromium browser framework.
// The framework API is Apache-2.0; engine distribution includes GPL-3.0 code.
#import "ArdiaCore.h"
#import "ExtensionPanel.h"
#import "ExtensionSidebar.h"
#import "ImportProcess.h"
#import "DeviceChooser.h"
#import "PromptPopover.h"
#import "MiniWindow.h"
#import "CastPicker.h"
#import "WebKitPage.h"
#import <AppKit/AppKit.h>
#include <cmath>
#include <dlfcn.h>
#include <fcntl.h>
#include <CoreServices/CoreServices.h>
#include <libproc.h>
#include <string>
#include <unistd.h>
#include <vector>

// Wing's source-built framework adds this narrow, policy-aware preference API.
typedef void (*WingEngineReply)(void *context, const char *json);
typedef void (*WingEngineCall)(const char *profile, const char *args, WingEngineReply reply, void *context);
static void ExtensionsReplied(void *context, const char *json) {
  void (^done)(NSArray<NSDictionary *> *) = (__bridge_transfer void (^)(NSArray<NSDictionary *> *))context;
  NSData *body = json ? [@(json) dataUsingEncoding:NSUTF8StringEncoding] : nil;
  NSDictionary *reply = body ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil] : nil;
  NSArray *list = [reply isKindOfClass:NSDictionary.class] ? reply[@"extensions"] : nil;
  done([list isKindOfClass:NSArray.class] ? list : @[]);
}
static void EngineReplied(void *context, const char *json) {
  void (^done)(NSDictionary *) = (__bridge_transfer void (^)(NSDictionary *))context;
  NSData *body = json ? [@(json) dataUsingEncoding:NSUTF8StringEncoding] : nil;
  id reply = body ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil] : nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    done([reply isKindOfClass:NSDictionary.class] ? reply : @{});
  });
}
static void CallEngine(const char *name, ArdiaCoreProfile *profile, NSDictionary *args,
                       void (^done)(NSDictionary *)) {
  auto call = (WingEngineCall)dlsym(RTLD_DEFAULT, name);
  NSData *body = [NSJSONSerialization dataWithJSONObject:args options:0 error:nil];
  if (!profile || !call || !body) {
    done(@{});
    return;
  }
  NSString *json = [[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding];
  call(profile.path.UTF8String, json.UTF8String, EngineReplied, (__bridge_retained void *)[done copy]);
}
// The engine moved the installed-extension list from ArdiaCoreProfile to its C call table.
static void ListExtensions(ArdiaCoreProfile *profile, void (^done)(NSArray<NSDictionary *> *)) {
  auto call = (WingEngineCall)dlsym(RTLD_DEFAULT, "ac_extensions_list");
  if (!profile || !call) {
    done(@[]);
    return;
  }
  call(profile.path.UTF8String, "{}", ExtensionsReplied, (__bridge_retained void *)[done copy]);
}
@interface ArdiaCoreProfile (WingDownloadDirectory)
- (BOOL)setDownloadDirectory:(NSString *)directory;
- (void)flushCookiesWithCompletion:(void (^)(void))completion;
- (void)importLogins:(NSArray<NSDictionary *> *)entries
          completion:(void (^)(NSInteger count, NSString *error))completion;
@end

// Capture without resizing the live page or changing its scroll position.
static NSComparisonResult CompareSubviewRank(NSView *a, NSView *b, void *context) {
  NSMapTable *ranks = (__bridge NSMapTable *)context;
  return [[ranks objectForKey:a] compare:[ranks objectForKey:b]];
}
static void CapturePage(ArdiaCoreTab *page, BOOL fullPage,
                        void (^completion)(NSData *, NSString *)) {
  NSString *documentURL = [page.url copy];
  void (^capture)(NSDictionary *) = ^(NSDictionary *clip) {
    if (page.closed || ![documentURL isEqual:page.url]) {
      completion(nil, @"The page changed before capture completed."); return;
    }
    NSMutableDictionary *params = [@{@"format":@"png", @"captureBeyondViewport":@(fullPage)} mutableCopy];
    if (clip) params[@"clip"] = clip;
    [page devToolsCall:@"Page.captureScreenshot" params:params timeout:0 completion:^(NSDictionary *result, NSString *error) {
      NSData *body = [result[@"data"] isKindOfClass:NSString.class]
        ? [[NSData alloc] initWithBase64EncodedString:result[@"data"] options:0] : nil;
      if (page.closed || ![documentURL isEqual:page.url]) {
        completion(nil, @"The page changed before capture completed."); return;
      }
      completion(body, error ?: (body.length ? nil : @"Page capture failed."));
    }];
  };
  if (!fullPage) { capture(nil); return; }
  [page devToolsCall:@"Page.getLayoutMetrics" params:@{} timeout:0 completion:^(NSDictionary *result, NSString *error) {
    NSDictionary *size = result[@"cssContentSize"];
    double width = [size[@"width"] doubleValue], height = [size[@"height"] doubleValue];
    // Bound the raster allocation; never silently crop or shrink the document.
    if (error || !std::isfinite(width) || !std::isfinite(height) ||
        width <= 0 || height <= 0 || width > 32767 || height > 32767 || width * height > 64000000) {
      completion(nil, error ?: @"This page is too large for a full-page image. Capture the visible page instead."); return;
    }
    capture(@{@"x":size[@"x"] ?: @0, @"y":size[@"y"] ?: @0,
              @"width":@(width), @"height":@(height), @"scale":@1});
  }];
}

static NSString *JSON(id object) {
  NSData *data =
      [NSJSONSerialization dataWithJSONObject:object
                                      options:NSJSONWritingFragmentsAllowed
                                        error:nil];
  return data ? [[NSString alloc] initWithData:data
                                      encoding:NSUTF8StringEncoding]
              : @"null";
}
static id Parse(NSString *text) {
  if (![text isKindOfClass:NSString.class])
    return nil;
  return [NSJSONSerialization
      JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding]
                 options:NSJSONReadingFragmentsAllowed
                   error:nil];
}
static BOOL gUncleanExit = NO;
static std::string gRunningMarker;
static BOOL Identifier(id value) {
  return
      [value isKindOfClass:NSString.class] && [value length] > 0 &&
      [value length] <= 100 &&
      [value
          rangeOfCharacterFromSet:[[NSCharacterSet
                                      characterSetWithCharactersInString:
                                          @"abcdefghijklmnopqrstuvwxyzABCDEFGHI"
                                          @"JKLMNOPQRSTUVWXYZ0123456789_-"]
                                      invertedSet]]
              .location == NSNotFound;
}
static BOOL WebURL(NSString *value) {
  if (![value isKindOfClass:NSString.class])
    return NO;
  NSURL *url = [NSURL URLWithString:value];
  if ([url.scheme isEqual:@"chrome-extension"] && url.host.length == 32 &&
      !url.user && !url.password &&
      [url.host rangeOfCharacterFromSet:
                    [[NSCharacterSet
                        characterSetWithCharactersInString:@"abcdefghijklmnop"]
                        invertedSet]]
              .location == NSNotFound)
    return YES;
  // Chromium's password manager, history and clear-data pages are the only
  // privileged pages a tab may show; this mirrors internalPage() in model.cjs.
  if ([url.scheme isEqual:@"chrome"] && !url.user && !url.password &&
      ([url.host isEqual:@"password-manager"] || [url.host isEqual:@"history"] ||
       ([url.host isEqual:@"settings"] && [url.path isEqual:@"/clearBrowserData"])) &&
      ![value containsString:@".."])
    return YES;
  return [value isEqual:@"about:blank"] ||
         (([url.scheme isEqual:@"https"] || [url.scheme isEqual:@"http"]) &&
          url.host.length);
}
static BOOL SaveWorkspace(NSData *body, NSString *path) {
  std::string pattern =
      std::string(path.fileSystemRepresentation) + ".tmp.XXXXXX";
  std::vector<char> temporary(pattern.begin(), pattern.end());
  temporary.push_back('\0');
  int descriptor =
      mkstemp(temporary.data()); // private (0600), same-volume file
  if (descriptor < 0)
    return NO;
  const char *bytes = static_cast<const char *>(body.bytes);
  NSUInteger written = 0;
  BOOL valid = YES;
  while (written < body.length) {
    ssize_t count = write(descriptor, bytes + written, body.length - written);
    if (count < 0 && errno == EINTR)
      continue;
    if (count <= 0) {
      valid = NO;
      break;
    }
    written += count;
  }
  if (valid && fsync(descriptor) != 0)
    valid = NO;
  if (close(descriptor) != 0)
    valid = NO;
  if (valid && rename(temporary.data(), path.fileSystemRepresentation) != 0)
    valid = NO;
  if (!valid)
    unlink(temporary.data());
  return valid;
}
static BOOL ValidSync(NSDictionary *data) {
  NSDictionary *state = data[@"workspace"];
  if (![state isKindOfClass:NSDictionary.class] ||
      ![state[@"tabs"] isKindOfClass:NSArray.class] ||
      ![state[@"spaces"] isKindOfClass:NSArray.class] ||
      ![data[@"panes"] isKindOfClass:NSArray.class] ||
      [data[@"panes"] count] > 3 || [state[@"tabs"] count] > 10000 ||
      [state[@"spaces"] count] > 10000)
    return NO;
  NSMutableSet *spaces = [NSMutableSet new], *tabs = [NSMutableSet new];
  for (id space in state[@"spaces"]) {
    if (![space isKindOfClass:NSDictionary.class] ||
        !Identifier(space[@"id"]) || !Identifier(space[@"profileId"]) ||
        [spaces containsObject:space[@"id"]])
      return NO;
    [spaces addObject:space[@"id"]];
  }
  for (id tab in state[@"tabs"]) {
    if (![tab isKindOfClass:NSDictionary.class] || !Identifier(tab[@"id"]) ||
        ![spaces containsObject:tab[@"spaceId"]] ||
        [tabs containsObject:tab[@"id"]] ||
        (![tab[@"url"] isEqual:@"wing://home"] && ![tab[@"url"] isEqual:@"wing://pulls"] &&
         !WebURL(tab[@"url"])))
      return NO;
    [tabs addObject:tab[@"id"]];
  }
  NSMutableSet *visible = [NSMutableSet new];
  for (id pane in data[@"panes"]) {
    if (![pane isKindOfClass:NSDictionary.class] ||
        ![tabs containsObject:pane[@"id"]] ||
        [visible containsObject:pane[@"id"]])
      return NO;
    [visible addObject:pane[@"id"]];
    for (NSString *key in @[ @"x", @"y", @"width", @"height" ]) {
      if (![pane[key] isKindOfClass:NSNumber.class] ||
          !std::isfinite([pane[key] doubleValue]) ||
          [pane[key] doubleValue] < 0 || [pane[key] doubleValue] > 32768)
        return NO;
    }
  }
  return YES;
}

@interface WingChromiumHost
    : NSObject <ArdiaCoreEngineDelegate, ArdiaCoreWindowDelegate,
                ArdiaCoreTabDelegate>
@end
static WingChromiumHost *gMainHost;
static NSMutableArray<WingChromiumHost *> *gPrivateHosts;
static __weak ArdiaCoreProfile *gLastPrivateProfile;
// Human wording for site prompts.
static NSString *SiteName(NSString *origin) {
  NSString *host = [NSURL URLWithString:origin ?: @""].host ?: origin ?: @"This website";
  return [host hasPrefix:@"www."] ? [host substringFromIndex:4] : host;
}
static NSString *PermissionPhrase(NSArray *kinds) {
  NSDictionary *phrases = @{
    @"camera" : @"use your camera",
    @"video" : @"use your camera",
    @"microphone" : @"use your microphone",
    @"audio" : @"use your microphone",
    @"geolocation" : @"know your location",
    @"location" : @"know your location",
    @"notifications" : @"send you notifications",
    @"clipboard" : @"see what you copy",
    @"midi" : @"control MIDI devices",
    @"storage" : @"use cookies and site data",
    @"window" : @"manage windows on your displays",
    @"idle" : @"know when you’re using this device",
    @"sensors" : @"use motion sensors",
    @"local-fonts" : @"use fonts on your Mac",
    @"pointer" : @"lock your pointer",
    @"keyboard" : @"lock your keyboard",
  };
  NSMutableOrderedSet *parts = [NSMutableOrderedSet new];
  for (id kind in [kinds isKindOfClass:NSArray.class] ? kinds : @[]) {
    NSString *name = [[kind description] lowercaseString], *phrase;
    for (NSString *key in phrases)
      if ([name containsString:key]) { phrase = phrases[key]; break; }
    [parts addObject:phrase ?: [@"use " stringByAppendingString:
                                   [name stringByReplacingOccurrencesOfString:@"-" withString:@" "]]];
  }
  if (!parts.count) return @"access this feature";
  if (parts.count == 1) return parts.firstObject;
  NSArray *list = parts.array;
  return [[[list subarrayWithRange:NSMakeRange(0, list.count - 1)] componentsJoinedByString:@", "]
      stringByAppendingFormat:@" and %@", list.lastObject];
}
static NSString *PermissionSymbol(NSArray *kinds) {
  NSString *all = [[[kinds isKindOfClass:NSArray.class] ? kinds : @[] componentsJoinedByString:@" "] lowercaseString];
  if ([all containsString:@"camera"] || [all containsString:@"video"]) return @"video.fill";
  if ([all containsString:@"micro"] || [all containsString:@"audio"]) return @"mic.fill";
  if ([all containsString:@"location"]) return @"location.fill";
  if ([all containsString:@"notification"]) return @"bell.badge.fill";
  if ([all containsString:@"clipboard"]) return @"doc.on.clipboard";
  return @"hand.raised.fill";
}
static NSUInteger gHoverPeekGeneration;
// uBlock Origin Lite: declarative rules the engine applies without a background page.
static NSString *const kProtectionFolder = @"uBOLite.chromium";
@implementation WingChromiumHost {
  ArdiaCoreWindow *_window, *_uiWindow;
  ArdiaCoreTab *_shell;
  NSMutableString *_requestParts;
  NSNumber *_requestPartsId;
  NSDate *_lastBackup;
  NSMutableDictionary *_externalSpaces;
  NSString *_shellURL, *_workspacePath;
  NSMutableDictionary<NSString *, ArdiaCoreTab *> *_tabs;
  NSMutableDictionary<NSString *, ArdiaCoreProfile *> *_profiles;
  NSMutableDictionary<NSString *, NSString *> *_modelURLs;
  NSMutableDictionary<NSString *, NSNumber *> *_closing;
  NSMutableDictionary<NSString *, NSNumber *> *_freezeGenerations;
  dispatch_source_t _memoryPressure;
  NSMutableSet<NSString *> *_loadingProfiles;
  NSMutableSet<NSString *> *_capturingTabs;
  NSMutableSet<NSString *> *_wakingTabs;
  NSMutableDictionary<NSString *, NSNumber *> *_departures;
  // A page in HTML fullscreen (a video's ⤢ button) fills the whole window, and
  // the window goes full screen with it unless it already was.
  ArdiaCoreTab *_fullscreenTab;
  BOOL _fullscreenTookWindow;
  NSMutableSet<NSString *> *_pendingCreatedTabs;
  NSMutableSet<NSString *> *_protectedProfiles;
  NSMutableSet<NSString *> *_checkingProtection;
  NSMutableSet<NSString *> *_startingProtection;
  NSMutableDictionary<NSString *, ArdiaCoreTab *> *_protectionTabs;
  NSMutableDictionary<NSString *, NSDate *> *_protectionDeadlines;
  NSMutableDictionary<NSString *, NSString *> *_protectionURLs;
  NSMutableDictionary<NSString *, ArdiaCoreTab *> *_serviceTabs;
  NSMutableDictionary<NSString *, NSString *> *_serviceURLs;
  NSMutableDictionary<NSString *, ArdiaCoreTab *> *_extensionManagers;
  // Pages whose back/forward list and scroll position may still be restorable.
  NSMutableSet<NSString *> *_restorableTabs;
  NSMutableSet<NSString *> *_restoringTabs;
  NSMutableDictionary<NSString *, NSValue *> *_extensionWatches;
  NSMutableDictionary<NSNumber *, NSDictionary *> *_processSamples;
  WingImportProcess *_importProcess;
  WingExtensionPanel *_extensionPanel;
  WingExtensionSidebar *_extensionSidebar;
  NSString *_extensionSidebarOwner;
  NSString *_extensionPanelOwner;
  NSMutableSet<NSString *> *_importProfiles;
  NSSet<NSString *> *_importExistingProfiles;
  BOOL _importCommitted;
  BOOL _automaticTrimRunning;
  NSMutableDictionary<NSNumber *, WingImportReply> *_hostReplies;
  NSInteger _hostSequence;
  NSDictionary *_lastSync;
  id _resizeObserver;
  id _modifierObserver;
  id _mouseDownMonitor;
  NSEvent *_lastMouseDown;
  NSTimer *_maintenanceTimer;
  NSMutableDictionary<NSString *, NSString *> *_appliedStyles;
  NSMutableDictionary<NSString *, WingPromptPopover *> *_permissionAlerts;
  NSMutableDictionary<NSString *, NSString *> *_crashedTabs;
  NSMutableDictionary<NSString *, WingPromptPopover *> *_hangPrompts;
  NSMutableDictionary<NSString *, NSDictionary *> *_externalAppAlerts;
  NSMutableDictionary<NSNumber *, WingDeviceChooser *> *_deviceChoosers;
  WingCastPicker *_castPicker;
  NSView *_hoverCard;
  ArdiaCoreTab *_hoverTab;
  NSString *_hoverURL;
  BOOL _automaticPictureInPicture;
  NSMutableSet<NSString *> *_pictureInPictureTabs;
  // Pages Wing floated into picture in picture itself (a tab switch or leaving
  // the app); they come back into the window when they're shown again.
  NSMutableSet<NSString *> *_miniPlayerTabs;
  // Tabs shown by WebKit instead of Chromium (streaming sites, for DRM video).
  NSMutableDictionary<NSString *, WingWebKitPage *> *_webkitPages;
  NSMutableSet<NSString *> *_screenSharingTabs;
  BOOL _quitting;
  BOOL _qualificationStarted;
  BOOL _shellRaised;
  NSMutableArray<NSString *> *_externalURLs;
  // A private window is a second host on an off-the-record profile. It shares
  // the shell and layout code, never touches disk, and leaves app-wide duties
  // (menus, Apple events, maintenance) to the main host.
  BOOL _private;
  NSDictionary *_privateSettings;
  NSMutableArray *_observers;
  id _themeObserver;
}
- (void)send:(NSString *)kind data:(id)data {
  if (_shell && !_shell.closed)
    [_shell callPage:@"wing-native"
                json:JSON(@{@"kind" : kind, @"data" : data ?: @{}})];
}
- (void)reply:(NSNumber *)request result:(id)result error:(NSString *)error {
  WingImportReply callback = _hostReplies[request];
  if (callback) {
    [_hostReplies removeObjectForKey:request];
    callback(result, error);
    return;
  }
  [self send:@"response"
        data:error ? @{@"id" : request, @"error" : error}
                   : @{@"id" : request, @"result" : result ?: @{}}];
}
- (void)service:(NSDictionary *)request
        profile:(NSString *)profileId
          reply:(NSNumber *)rid
       attempts:(int)attempts {
  if (attempts <= 0 || _quitting) {
    if (getenv("WING_CHROMIUM_TEST_SCRIPT")) {
      ArdiaCoreTab *probe = _serviceTabs[profileId];
      fprintf(stderr,
              "Service startup failed: profile=%s url=%s title=%s loading=%d "
              "closed=%d\n",
              profileId.UTF8String, probe.url.UTF8String,
              probe.title.UTF8String, probe.loading, probe.closed);
    }
    [self reply:rid result:nil error:@"Browser services could not initialize."];
    return;
  }
  ArdiaCoreProfile *profile = _profiles[profileId];
  if (!profile) {
    [ArdiaCoreEngine.sharedEngine
        loadProfile:[@"Wing-" stringByAppendingString:profileId]
         completion:^(ArdiaCoreProfile *loaded) {
           if (!loaded) {
             [self reply:rid result:nil error:@"Profile could not load."];
             return;
           }
           if (self->_quitting) {
             [self reply:rid result:nil error:@"Browser is closing."];
             return;
           }
           self->_profiles[profileId] = loaded;
           [self->_window prepareProfile:loaded];
           [loaded loadComponentExtension:
                       [NSBundle.mainBundle.resourcePath
                           stringByAppendingPathComponent:kProtectionFolder]];
           [self service:request
                 profile:profileId
                   reply:rid
                attempts:attempts - 1];
         }];
    return;
  }
  ArdiaCoreTab *control = _serviceTabs[profileId];
  if (!control || control.closed) {
    NSString *extensionId =
        [profile loadComponentExtension:
                     [NSBundle.mainBundle.resourcePath
                         stringByAppendingPathComponent:@"WingServices"]];
    if (!extensionId.length) {
      [self reply:rid
           result:nil
            error:@"Browser services extension could not load."];
      return;
    }
    NSString *url = [NSString
        stringWithFormat:@"chrome-extension://%@/control.html", extensionId];
    control = [_window openTab:url profile:profile foreground:NO];
    _serviceTabs[profileId] = control;
    _serviceURLs[profileId] = url;
    control.delegate = self;
  }
  NSString *expectedOrigin = [_serviceURLs[profileId]
      stringByReplacingOccurrencesOfString:@"/control.html"
                                withString:@""];
  if (![control.url isEqual:_serviceURLs[profileId]] ||
      ![control.committedOrigin isEqual:expectedOrigin]) {
    if (!control.loading)
      [control loadURL:_serviceURLs[profileId] userInitiated:NO];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
                     [self service:request
                           profile:profileId
                             reply:rid
                          attempts:attempts - 1];
                   });
    return;
  }
  NSString *script = [NSString
      stringWithFormat:
          @"if(!window.wingService){post('result',JSON.stringify({"
          @"waiting:true,title:document.title,ready:document.readyState,url:"
          @"location.href}));}else{window.wingService(%@,%@).then("
          @"value=>post('result',JSON.stringify({value})),error=>"
          @"post('result',JSON.stringify({error:error.message})));}",
          JSON(request[@"method"]), JSON(request[@"args"] ?: @{})];
  [control
        evaluate:script
      completion:^(NSString *raw) {
        id result = raw ? Parse(raw) : nil;
        if ([result isKindOfClass:NSString.class])
          result = Parse(result);
        if (!result || [result[@"waiting"] boolValue]) {
          if (attempts == 1 && getenv("WING_CHROMIUM_TEST_SCRIPT"))
            fprintf(stderr, "Service readiness: %s\n",
                    raw.UTF8String ?: "missing");
          if (attempts % 10 == 0 && !control.closed) {
            [profile loadComponentExtension:
                         [NSBundle.mainBundle.resourcePath
                             stringByAppendingPathComponent:@"WingServices"]];
            [control loadURL:self->_serviceURLs[profileId] userInitiated:NO];
          }
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                         dispatch_get_main_queue(), ^{
                           [self service:request
                                 profile:profileId
                                   reply:rid
                                attempts:attempts - 1];
                         });
        } else
          [self reply:rid result:result[@"value"] error:result[@"error"]];
      }];
}
- (void)engine:(ArdiaCoreEngine *)engine
    permissionRequest:(NSDictionary *)request
                  tab:(ArdiaCoreTab *)tab {
  NSString *requestId = request[@"id"];
  if (![requestId isKindOfClass:NSString.class])
    return;
  WingChromiumHost *owner = [WingChromiumHost hostForTab:tab];
  if (owner != self) {
    [owner engine:engine permissionRequest:request tab:tab];
    return;
  }
  if (![self identityForTab:tab] || tab.closed) {
    [ArdiaCoreEngine resolvePermission:requestId result:@"deny" remember:NO];
    return;
  }
  NSString *origin = tab.committedOrigin;
  NSString *site = SiteName(request[@"origin"] ?: origin);
  NSArray *kinds = request[@"permissions"];
  NSString *wants = PermissionPhrase(kinds);
  _permissionAlerts[requestId] = [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:PermissionSymbol(kinds)
           title:[NSString stringWithFormat:@"Allow “%@” to %@?", site, wants]
         message:@"You can change this anytime in Site Controls."
         buttons:@[ @"Don’t Allow", @"Allow" ]
        remember:@"Remember my choice for this site"
      completion:^(NSInteger choice, BOOL remember) {
        [self->_permissionAlerts removeObjectForKey:requestId];
        BOOL accepted = choice == 1 && !tab.closed && [origin isEqual:tab.committedOrigin];
        // Dismissing without a choice asks again next time.
        [ArdiaCoreEngine resolvePermission:requestId
                           result:accepted ? @"accept" : @"deny"
                         remember:choice >= 0 && remember];
      }];
}
- (void)engine:(ArdiaCoreEngine *)engine
    permissionRequestDismissed:(NSString *)requestId {
  if (self == gMainHost)
    for (WingChromiumHost *host in gPrivateHosts)
      if (host->_permissionAlerts[requestId]) {
        [host engine:engine permissionRequestDismissed:requestId];
        return;
      }
  WingPromptPopover *prompt = _permissionAlerts[requestId];
  [_permissionAlerts removeObjectForKey:requestId];
  [prompt dismiss];
}
- (void)cancelDeviceRequestsForTab:(ArdiaCoreTab *)tab {
  for (WingDeviceChooser *chooser in [_deviceChoosers.allValues copy])
    if (chooser.tab == tab) [chooser cancel];
}
- (void)engine:(ArdiaCoreEngine *)engine deviceChooser:(NSDictionary *)state tab:(ArdiaCoreTab *)tab {
  WingChromiumHost *owner = [WingChromiumHost hostForTab:tab];
  if (owner != self) {
    [owner engine:engine deviceChooser:state tab:tab];
    return;
  }
  NSNumber *identity = state[@"id"];
  if (![identity isKindOfClass:NSNumber.class]) return;
  WingDeviceChooser *chooser = _deviceChoosers[identity];
  if (!chooser && [state[@"open"] boolValue]) {
    if (_quitting || ![self identityForTab:tab] || tab.closed) {
      [ArdiaCoreEngine cancelDeviceChooser:identity.intValue];
      return;
    }
    chooser = [[WingDeviceChooser alloc] initWithTab:tab window:_window.window];
    __weak WingChromiumHost *host = self;
    chooser.onClose = ^{
      WingChromiumHost *owner = host;
      if (owner) [owner->_deviceChoosers removeObjectForKey:identity];
    };
    _deviceChoosers[identity] = chooser;
  }
  [chooser update:state];
}
- (void)cancelExternalRequestsForTab:(ArdiaCoreTab *)tab {
  for (NSString *requestId in _externalAppAlerts.allKeys) {
    NSDictionary *entry = _externalAppAlerts[requestId];
    if (entry[@"tab"] != tab) continue;
    [_externalAppAlerts removeObjectForKey:requestId];
    [entry[@"alert"] dismiss];
    [ArdiaCoreEngine resolveExternalApp:requestId open:NO remember:NO];
  }
}
- (void)tab:(ArdiaCoreTab *)tab externalAppRequest:(NSDictionary *)request {
  NSString *requestId = request[@"id"];
  if (![requestId isKindOfClass:NSString.class]) return;
  if (![self identityForTab:tab] || tab.closed || _quitting) {
    [ArdiaCoreEngine resolveExternalApp:requestId open:NO remember:NO];
    return;
  }
  if (_externalAppAlerts[requestId]) return;
  BOOL available = [request[@"appPath"] isKindOfClass:NSString.class];
  NSString *remember = available && [request[@"remember"] isKindOfClass:NSString.class] ? request[@"remember"] : nil;
  NSString *origin = tab.committedOrigin;
  WingPromptPopover *prompt = [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:@"arrow.up.forward.app"
           title:[request[@"title"] isKindOfClass:NSString.class] ? request[@"title"] : @"Open another application?"
         message:[request[@"message"] isKindOfClass:NSString.class] ? request[@"message"] : @"This website requested an external application."
         buttons:available ? @[ @"Cancel", @"Open" ] : @[ @"OK" ]
        remember:remember
      completion:^(NSInteger choice, BOOL rememberChoice) {
        if (!self->_externalAppAlerts[requestId]) return;
        [self->_externalAppAlerts removeObjectForKey:requestId];
        BOOL open = available && choice == 1 && !tab.closed &&
                    [origin isEqual:tab.committedOrigin] && !self->_quitting;
        [ArdiaCoreEngine resolveExternalApp:requestId open:open remember:open && rememberChoice];
      }];
  _externalAppAlerts[requestId] = @{@"alert" : prompt, @"tab" : tab};
}
- (void)saveData:(NSData *)body name:(NSString *)name reply:(NSNumber *)rid {
  if (!body) {
    [self reply:rid result:nil error:@"The page could not be exported."];
    return;
  }
  NSSavePanel *panel = [NSSavePanel savePanel];
  panel.nameFieldStringValue = name.lastPathComponent;
  [panel beginSheetModalForWindow:_window.window
                completionHandler:^(NSModalResponse response) {
                  if (response != NSModalResponseOK) {
                    [self reply:rid result:@{@"cancelled" : @YES} error:nil];
                    return;
                  }
                  NSError *error;
                  BOOL saved = [body writeToURL:panel.URL
                                        options:NSDataWritingAtomic
                                          error:&error];
                  [self reply:rid
                       result:@{
                         @"ok" : @(saved)
                       }
                        error:error.localizedDescription];
                }];
}
- (void)engine:(ArdiaCoreEngine *)engine
    extensionInstallPrompt:(NSDictionary *)prompt
                   profile:(ArdiaCoreProfile *)profile
                       tab:(ArdiaCoreTab *)tab {
  if (getenv("WING_CHROMIUM_TEST_SCRIPT") && getenv("WING_TEST_ACCEPT_EXTENSIONS")) {
    [ArdiaCoreEngine resolveExtensionInstallPrompt:prompt[@"requestId"] accepted:YES];
    return;
  }
  NSArray *permissions = [prompt[@"permissions"] isKindOfClass:NSArray.class] ? prompt[@"permissions"] : @[];
  [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:@"puzzlepiece.extension"
           title:[NSString stringWithFormat:@"Add “%@”?", prompt[@"name"]]
         message:permissions.count
                     ? [@"It can:\n• " stringByAppendingString:[permissions componentsJoinedByString:@"\n• "]]
                     : [NSString stringWithFormat:@"Version %@", prompt[@"version"]]
         buttons:@[ @"Cancel", @"Add Extension" ]
        remember:nil
      completion:^(NSInteger choice, BOOL remember) {
        [ArdiaCoreEngine resolveExtensionInstallPrompt:prompt[@"requestId"] accepted:choice == 1];
      }];
}
// Cast: the engine discovers devices and owns routes; Wing shows the list.
- (void)engine:(ArdiaCoreEngine *)engine
    castDialog:(NSDictionary *)dialog
           tab:(ArdiaCoreTab *)tab {
  WingChromiumHost *owner = [WingChromiumHost hostForTab:tab];
  if (owner && owner != self) {
    [owner engine:engine castDialog:dialog tab:tab];
    return;
  }
  if (_castPicker && _castPicker.tab != tab) {
    [_castPicker close];
    _castPicker = nil;
  }
  if (!_castPicker) {
    if (![dialog[@"open"] boolValue] || _quitting || tab.closed) {
      if ([dialog[@"open"] boolValue]) [ArdiaCoreEngine closeCastDialog:[dialog[@"id"] intValue]];
      return;
    }
    _castPicker = [[WingCastPicker alloc] initWithTab:tab view:_window.hostView anchor:[self promptAnchor]];
    __weak WingChromiumHost *host = self;
    __weak WingCastPicker *picker = _castPicker;
    _castPicker.onClose = ^{
      WingChromiumHost *owner = host;
      if (owner && owner->_castPicker == picker) owner->_castPicker = nil;
    };
  }
  [_castPicker update:dialog];
}
- (void)engine:(ArdiaCoreEngine *)engine
    castRoutes:(NSArray *)routes
       profile:(ArdiaCoreProfile *)profile {
  NSMutableArray *active = [NSMutableArray array];
  for (NSDictionary *route in routes)
    if ([route isKindOfClass:NSDictionary.class]) [active addObject:route];
  for (WingChromiumHost *host in [@[ gMainHost ?: self ] arrayByAddingObjectsFromArray:gPrivateHosts ?: @[]])
    if (host->_profiles.allValues.count && [host->_profiles.allValues containsObject:profile])
      [host send:@"command" data:@{@"type" : @"cast-routes", @"routes" : active}];
}
- (void)engine:(ArdiaCoreEngine *)engine
    extensionInstallFailed:(NSString *)message
                       tab:(ArdiaCoreTab *)tab {
  [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:@"puzzlepiece.extension"
           title:@"Couldn’t add the extension"
         message:message
         buttons:@[ @"OK" ]
        remember:nil
      completion:^(NSInteger choice, BOOL remember) {}];
}
- (void)window:(ArdiaCoreWindow *)window
    autofillPrompt:(NSDictionary<NSString *, id> *)prompt
            forTab:(ArdiaCoreTab *)tab {
  NSString *key = [NSString stringWithFormat:@"autofill-%@", prompt[@"id"]];
  if ([prompt[@"closed"] boolValue]) {
    WingPromptPopover *existing = _permissionAlerts[key];
    [_permissionAlerts removeObjectForKey:key];
    [existing dismiss];
    return;
  }
  if (![self identityForTab:tab] || _permissionAlerts[key])
    return;
  NSMutableArray *lines = [NSMutableArray new];
  for (NSString *field in @[ @"origin", @"message" ])
    if ([prompt[field] isKindOfClass:NSString.class])
      [lines addObject:prompt[field]];
  if ([prompt[@"lines"] isKindOfClass:NSArray.class])
    [lines addObjectsFromArray:prompt[@"lines"]];
  _permissionAlerts[key] = [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:@"person.text.rectangle"
           title:prompt[@"title"] ?: @"Save autofill information?"
         message:[lines componentsJoinedByString:@"\n"]
         buttons:@[ prompt[@"decline"] ?: @"Not Now", prompt[@"accept"] ?: @"Save" ]
        remember:nil
      completion:^(NSInteger choice, BOOL remember) {
        if (!self->_permissionAlerts[key]) return;
        [self->_permissionAlerts removeObjectForKey:key];
        [tab resolveAutofillPrompt:[prompt[@"id"] integerValue]
                            action:choice == 1 ? @"accept" : @"decline"];
      }];
}
- (BOOL)showExtensionPopup:(NSString *)extensionId tab:(ArdiaCoreTab *)tab {
  NSString *identity = [self identityForTab:tab];
  if (!identity)
    return NO;
  NSDictionary *state =
      [tab actionStatesForExtensions:@[ extensionId ]][extensionId];
  NSString *url = state[@"popup"];
  if (![url hasPrefix:[NSString stringWithFormat:@"chrome-extension://%@/",
                                                 extensionId]])
    return NO;
  _extensionPanelOwner = identity;
  return [_extensionPanel showURL:url browser:_window profile:tab.profile];
}
- (void)focusAfterExtensionChange {
  if (_quitting || _window.window.attachedSheet) return;
  ArdiaCoreTab *target = [_lastSync[@"panes"] count]
      ? (_extensionSidebar.page ?: _tabs[_lastSync[@"workspace"][@"activeTabId"]]) : _shell;
  [target focus];
}
- (void)closeExtensionViewsForTabID:(NSString *)identity {
  if ([_extensionSidebarOwner isEqual:identity]) {
    [_extensionSidebar close];
    _extensionSidebarOwner = nil;
  }
  if ([_extensionPanelOwner isEqual:identity]) {
    [_extensionPanel close];
    _extensionPanelOwner = nil;
  }
}
- (BOOL)showExtensionSidebar:(NSString *)extensionId tab:(ArdiaCoreTab *)tab {
  NSString *identity = [self identityForTab:tab];
  if (!identity || ![identity isEqual:_lastSync[@"workspace"][@"activeTabId"]]) return NO;
  BOOL opened = [_extensionSidebar open:extensionId from:tab browser:_window];
  _extensionSidebarOwner = opened ? identity : nil;
  [self applyLayout];
  if (opened) [self focusAfterExtensionChange];
  return opened;
}
- (void)engine:(ArdiaCoreEngine *)engine extensionSidePanel:(NSDictionary *)panel tab:(ArdiaCoreTab *)tab {
  if ([panel[@"open"] boolValue]) {
    [self showExtensionSidebar:panel[@"extensionId"] tab:tab];
  } else if ([_extensionSidebar.extensionId isEqual:panel[@"extensionId"]] &&
             [_extensionSidebarOwner isEqual:[self identityForTab:tab]]) {
    [_extensionSidebar close];
  }
}
- (BOOL)engine:(ArdiaCoreEngine *)engine
    extensionActionPopup:(NSDictionary *)popup
                     tab:(ArdiaCoreTab *)tab {
  return [self showExtensionPopup:popup[@"extensionId"] tab:tab];
}
- (BOOL)engine:(ArdiaCoreEngine *)engine
    extensionActionShortcut:(NSDictionary *)shortcut
                        tab:(ArdiaCoreTab *)tab {
  NSString *kind = [tab executeExtensionAction:shortcut[@"extensionId"]];
  return [kind isEqual:@"popup"]
             ? [self showExtensionPopup:shortcut[@"extensionId"] tab:tab]
             : [kind isEqual:@"sidePanel"] ? [self showExtensionSidebar:shortcut[@"extensionId"] tab:tab]
             : [kind isEqual:@"none"];
}
- (void)contextAction:(NSMenuItem *)item {
  NSDictionary *payload = item.representedObject;
  if ([@[ @"command", @"action" ] containsObject:payload[@"kind"]])
    [self send:payload[@"kind"] data:payload[@"data"]];
}
- (NSArray *)processMetrics {
  NSMutableArray *queue = [NSMutableArray arrayWithObject:@(getpid())],
                 *rows = [NSMutableArray new];
  NSMutableSet *seen = [NSMutableSet new];
  NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  for (NSUInteger i = 0; i < queue.count && i < 1000; i++) {
    NSNumber *pid = queue[i];
    if ([seen containsObject:pid])
      continue;
    [seen addObject:pid];
    int count = proc_listchildpids(pid.intValue, NULL, 0);
    if (count > 0) {
      std::vector<pid_t> children(count / sizeof(pid_t) + 16);
      int bytes = proc_listchildpids(pid.intValue, children.data(),
                                     (int)(children.size() * sizeof(pid_t)));
      for (int j = 0; j < bytes / (int)sizeof(pid_t); j++)
        if (children[j] > 0)
          [queue addObject:@(children[j])];
    }
    struct proc_taskinfo info = {};
    if (proc_pidinfo(pid.intValue, PROC_PIDTASKINFO, 0, &info, sizeof(info)) !=
        (int)sizeof(info))
      continue;
    double total = (double)(info.pti_total_user + info.pti_total_system) / 1e9;
    NSDictionary *previous = _processSamples[pid];
    double elapsed = now - [previous[@"time"] doubleValue];
    double cpu =
        previous && elapsed > 0
            ? MAX(0, (total - [previous[@"total"] doubleValue]) / elapsed * 100)
            : 0;
    _processSamples[pid] = @{@"time" : @(now), @"total" : @(total)};
    char path[PROC_PIDPATHINFO_MAXSIZE] = {};
    proc_pidpath(pid.intValue, path, sizeof(path));
    [rows addObject:@{
      @"pid" : pid,
      @"type" : pid.intValue == getpid() ? @"Browser"
                                         : [@(path) lastPathComponent],
      @"cpu" : @(cpu),
      @"workingSetKB" : @(info.pti_resident_size / 1024)
    }];
  }
  for (NSNumber *pid in _processSamples.allKeys)
    if (![seen containsObject:pid])
      [_processSamples removeObjectForKey:pid];
  return rows;
}
- (void)adoptPage:(ArdiaCoreTab *)tab identity:(NSString *)identity url:(NSString *)url {
  _tabs[identity] = tab;
  _modelURLs[identity] = url;
  tab.delegate = self;
  CallEngine("ac_tab_restore_tag", tab.profile, @{@"tab" : @(tab.tabId), @"key" : identity},
             ^(NSDictionary *reply){
             });
}
// Chromium keeps closed tabs' navigation entries, scroll positions included, by key.
- (void)restorePage:(NSString *)identity url:(NSString *)url profile:(ArdiaCoreProfile *)profile {
  [_restorableTabs removeObject:identity];
  [_restoringTabs addObject:identity];
  CallEngine("ac_tab_restore_take", profile, @{@"key" : identity}, ^(NSDictionary *reply) {
    [self->_restoringTabs removeObject:identity];
    if (self->_quitting || self->_tabs[identity])
      return;
    NSString *current = url;
    BOOL exists = NO;
    for (NSDictionary *record in self->_lastSync[@"workspace"][@"tabs"])
      if ([record[@"id"] isEqual:identity]) {
        current = record[@"url"];
        exists = YES;
      }
    if (!exists)
      return;
    NSString *state = [reply[@"state"] isKindOfClass:NSString.class] ? reply[@"state"] : nil;
    ArdiaCoreTab *tab = state.length ? [self->_window restoreTab:state profile:profile foreground:NO] : nil;
    if (tab && tab.url.length && ![tab.url isEqual:current])
      [tab loadURL:current userInitiated:NO];
    if (!tab)
      tab = [self->_window openTab:current profile:profile foreground:NO];
    [self adoptPage:tab identity:identity url:current];
    [self applyLayout];
  });
}
// uBlock Origin Lite's own messaging holds its per-site filtering modes.
- (void)allowlist:(ArdiaCoreTab *)helper
             host:(NSString *)host
            allow:(id)allow
            reply:(NSNumber *)rid
         attempts:(int)attempts {
  void (^finish)(id, NSString *) = ^(id result, NSString *error) {
    [helper closeNow];
    [self reply:rid result:result error:error];
  };
  if (attempts <= 0 || _quitting || helper.closed) {
    finish(nil, @"Content blocking didn't respond.");
    return;
  }
  void (^again)(void) = ^{
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [self allowlist:helper host:host allow:allow reply:rid attempts:attempts - 1];
    });
  };
  if (helper.loading || !helper.committedOrigin.length) {
    again();
    return;
  }
  NSData *args = [NSJSONSerialization dataWithJSONObject:@[ host, allow ] options:0 error:nil];
  // A trusted site is uBO Lite's "no filtering" mode (0); untrusting restores
  // the default mode.
  NSString *script = [NSString stringWithFormat:
      @"(async([host,allow])=>{const send=m=>chrome.runtime.sendMessage(m);"
      @"let level=globalThis.chrome?.runtime?.sendMessage?await send({what:'getFilteringMode',hostname:host}):undefined;"
      @"if(typeof level!=='number'){post('result',JSON.stringify({waiting:true}));return}"
      @"const has=level===0;if(allow!==null&&allow!==has){const target=allow?0:await send({what:'getDefaultFilteringMode'});"
      @"await send({what:'setFilteringMode',hostname:host,level:target})}"
      @"post('result',JSON.stringify({host,allowed:allow===null?has:allow}))})(%@).catch(e=>post('result',JSON.stringify({error:String(e)})))",
      [[NSString alloc] initWithData:args encoding:NSUTF8StringEncoding]];
  [helper evaluate:script
        completion:^(NSString *raw) {
          id result = raw ? Parse(raw) : nil;
          if ([result isKindOfClass:NSString.class])
            result = Parse(result);
          if (!result || [result[@"waiting"] boolValue])
            again();
          else
            finish(result, result[@"error"]);
        }];
}
static void ExtensionFolderChanged(ConstFSEventStreamRef stream, void *context, size_t count, void *paths,
                                   const FSEventStreamEventFlags *flags, const FSEventStreamEventId *ids) {
  NSDictionary *watch = (__bridge NSDictionary *)context;
  void (^changed)(void) = watch[@"changed"];
  changed();
}
- (BOOL)watchExtensions:(NSArray<NSDictionary *> *)unpacked
                profile:(NSString *)profileId
                enabled:(BOOL)enabled {
  if (!_extensionWatches)
    _extensionWatches = [NSMutableDictionary new];
  FSEventStreamRef old = (FSEventStreamRef)_extensionWatches[profileId].pointerValue;
  if (old) {
    FSEventStreamStop(old);
    FSEventStreamInvalidate(old);
    FSEventStreamRelease(old);
    [_extensionWatches removeObjectForKey:profileId];
  }
  if (!enabled || !unpacked.count)
    return NO;
  __block BOOL pending = NO;
  NSDictionary *watch = @{
    @"changed" : [^{
      if (pending)
        return;
      pending = YES;
      // Editors write in bursts; reload once they settle.
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        pending = NO;
        ArdiaCoreProfile *profile = self->_profiles[profileId];
        for (NSDictionary *extension in unpacked)
          CallEngine("ac_extensions_reload", profile, @{@"id" : extension[@"id"]}, ^(NSDictionary *reply){
          });
        [self send:@"command" data:@{@"type" : @"toast", @"message" : @"Reloaded your unpacked extensions"}];
      });
    } copy]
  };
  FSEventStreamContext context = {0, (__bridge void *)watch, CFRetain, CFRelease, NULL};
  FSEventStreamRef stream = FSEventStreamCreate(
      NULL, ExtensionFolderChanged, &context, (__bridge CFArrayRef)[unpacked valueForKey:@"path"],
      kFSEventStreamEventIdSinceNow, 0.3, kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer);
  if (!stream)
    return NO;
  FSEventStreamSetDispatchQueue(stream, dispatch_get_main_queue());
  FSEventStreamStart(stream);
  _extensionWatches[profileId] = [NSValue valueWithPointer:stream];
  return YES;
}
- (void)extensionManager:(NSString *)profileId
                 inspect:(BOOL)inspect
                   reply:(NSNumber *)rid
                attempts:(int)attempts {
  ArdiaCoreProfile *profile = _profiles[profileId];
  if (!profile || attempts <= 0 || _quitting) {
    [self reply:rid
         result:nil
          error:
              profile
                  ? @"The native extension manager could not initialize."
                  : @"Open a page in this profile before managing extensions."];
    return;
  }
  ArdiaCoreTab *manager = _extensionManagers[profileId];
  if (!manager || manager.closed) {
    manager = [_window openTab:@"chrome://extensions/"
                       profile:profile
                    foreground:NO];
    _extensionManagers[profileId] = manager;
    manager.delegate = self;
  }
  NSString *script =
      inspect
          ? @"post('result',JSON.stringify({available:typeof "
            @"chrome.developerPrivate?.loadUnpacked==='function'}));"
          : @"chrome.developerPrivate.loadUnpacked({failQuietly:true,"
            @"populateError:true}).then(error=>post('result',JSON.stringify("
            @"error?{error:JSON.stringify(error)}:{ok:true})),error=>post('"
            @"result',JSON.stringify({error:error.message})));";
  if (![manager.url isEqual:@"chrome://extensions/"] ||
      ![manager.committedOrigin isEqual:@"chrome://extensions"]) {
    if (!manager.loading)
      [manager loadURL:@"chrome://extensions/" userInitiated:NO];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
                     [self extensionManager:profileId
                                    inspect:inspect
                                      reply:rid
                                   attempts:attempts - 1];
                   });
    return;
  }
  script =
      [NSString stringWithFormat:
                    @"if(typeof "
                    @"chrome.developerPrivate?.loadUnpacked!=='function'){post("
                    @"'result',JSON.stringify({waiting:true}));}else{%@}",
                    script];
  [manager
        evaluate:script
      completion:^(NSString *raw) {
        id result = raw ? Parse(raw) : nil;
        if ([result isKindOfClass:NSString.class])
          result = Parse(result);
        if (!result || [result[@"waiting"] boolValue]) {
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                         dispatch_get_main_queue(), ^{
                           [self extensionManager:profileId
                                          inspect:inspect
                                            reply:rid
                                         attempts:attempts - 1];
                         });
          return;
        }
        [self reply:rid result:result error:result[@"error"]];
      }];
}
- (void)window:(ArdiaCoreWindow *)window
    passwordPrompt:(NSDictionary *)prompt
            forTab:(ArdiaCoreTab *)tab {
  NSString *state = prompt[@"state"];
  if (![self identityForTab:tab] ||
      ![@[ @"save", @"update" ] containsObject:state])
    return;
  BOOL update = [state isEqual:@"update"];
  NSString *origin = tab.committedOrigin;
  NSString *site = SiteName(prompt[@"origin"] ?: origin);
  NSArray *buttons = update ? @[ @"Not Now", @"Update Password" ]
                            : @[ @"Never for This Website", @"Not Now", @"Save Password" ];
  [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:@"key.fill"
           title:update ? [NSString stringWithFormat:@"Update the saved password for “%@”?", site]
                        : [NSString stringWithFormat:@"Save this password for “%@”?", site]
         message:[prompt[@"username"] length]
                     ? [NSString stringWithFormat:@"Account: %@\nPasswords are encrypted with your Mac’s keychain.", prompt[@"username"]]
                     : @"Passwords are encrypted with your Mac’s keychain."
         buttons:buttons
        remember:nil
      completion:^(NSInteger choice, BOOL remember) {
        if (tab.closed || ![origin isEqual:tab.committedOrigin]) return;
        NSString *action = choice == (NSInteger)buttons.count - 1 ? state
                         : (!update && choice == 0)             ? @"never"
                                                                : @"dismiss";
        [tab resolvePasswordPrompt:action username:nil password:nil];
      }];
}
- (void)importProfile:(NSString *)profileId
                ready:(void (^)(ArdiaCoreProfile *profile,
                                NSString *error))ready {
  if (!Identifier(profileId) || [profileId isEqual:@"default"] ||
      [profileId isEqual:@"work"]) {
    ready(nil, @"Import destination must be an imported profile.");
    return;
  }
  // Only a fresh profile may be rolled back. Re-imports update an existing one.
  if (![_importExistingProfiles containsObject:profileId])
    [_importProfiles addObject:profileId];
  if (_profiles[profileId]) {
    ready(_profiles[profileId], nil);
    return;
  }
  [ArdiaCoreEngine.sharedEngine
      loadProfile:[@"Wing-" stringByAppendingString:profileId]
       completion:^(ArdiaCoreProfile *profile) {
         if (self->_quitting) {
           ready(nil, @"Browser is closing.");
           return;
         }
         if (profile) {
           self->_profiles[profileId] = profile;
           // Register protection with the new profile's initial component set,
           // before the importer starts its private browser service document.
           [self->_window prepareProfile:profile];
           [profile loadComponentExtension:[NSBundle.mainBundle.resourcePath
                                               stringByAppendingPathComponent:
                                                   kProtectionFolder]];
         }
         ready(profile, profile ? nil : @"Import destination could not load.");
       }];
}
// Hourly copies of the workspace, so a bad write or import can be undone.
- (NSString *)backupsPath {
  return [_workspacePath.stringByDeletingLastPathComponent
      stringByAppendingPathComponent:@"wing-workspace-backups"];
}
- (NSArray<NSString *> *)backupFiles {
  NSArray *names = [NSFileManager.defaultManager
      contentsOfDirectoryAtPath:self.backupsPath
                          error:nil];
  // Timestamped names sort oldest to newest; return newest first.
  return [[names filteredArrayUsingPredicate:
                     [NSPredicate predicateWithFormat:@"SELF ENDSWITH '.json'"]]
              sortedArrayUsingSelector:@selector(compare:)]
      .reverseObjectEnumerator.allObjects;
}
- (void)backupWorkspace:(NSData *)body force:(BOOL)force {
  if (!body)
    return;
  NSFileManager *files = NSFileManager.defaultManager;
  if (!_lastBackup && self.backupFiles.count) {
    NSString *newest = [self.backupsPath
        stringByAppendingPathComponent:self.backupFiles.firstObject];
    _lastBackup = [files attributesOfItemAtPath:newest
                                          error:nil][NSFileModificationDate];
  }
  if (!force && _lastBackup && -_lastBackup.timeIntervalSinceNow < 3600)
    return;
  [files createDirectoryAtPath:self.backupsPath
      withIntermediateDirectories:YES
                       attributes:@{NSFilePosixPermissions : @0700}
                            error:nil];
  NSDateFormatter *format = [NSDateFormatter new];
  format.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  format.dateFormat = @"yyyyMMdd-HHmmss";
  NSString *name = [NSString
      stringWithFormat:@"workspace-%@.json", [format stringFromDate:NSDate.date]];
  if (SaveWorkspace(body, [self.backupsPath stringByAppendingPathComponent:name]))
    _lastBackup = NSDate.date;
  NSArray *all = self.backupFiles;
  for (NSUInteger i = 48; i < all.count; i++)
    [files removeItemAtPath:[self.backupsPath stringByAppendingPathComponent:all[i]]
                      error:nil];
}
// The damaged file is kept beside the workspace for inspection, never deleted.
- (NSDictionary *)recoverWorkspaceAfter:(NSInteger)after {
  NSFileManager *files = NSFileManager.defaultManager;
  if ([files fileExistsAtPath:_workspacePath]) {
    NSString *aside = [NSString
        stringWithFormat:@"%@.damaged-%.0f", _workspacePath,
                         NSDate.date.timeIntervalSince1970];
    [files moveItemAtPath:_workspacePath toPath:aside error:nil];
  }
  NSArray *all = self.backupFiles;
  for (NSInteger i = MAX(after + 1, 0); i < (NSInteger)all.count; i++) {
    NSData *body = [NSData
        dataWithContentsOfFile:[self.backupsPath stringByAppendingPathComponent:all[i]]];
    id state = body ? [NSJSONSerialization JSONObjectWithData:body
                                                      options:0
                                                        error:nil]
                    : nil;
    if ([state isKindOfClass:NSDictionary.class])
      return @{@"workspace" : state, @"index" : @(i)};
  }
  return @{@"workspace" : NSNull.null, @"index" : @(all.count)};
}
- (void)reportProblem:(id)sender {
  NSOperatingSystemVersion os = NSProcessInfo.processInfo.operatingSystemVersion;
  NSString *body = [NSString
      stringWithFormat:
          @"**What happened?**\n\n\n**What did you expect?**\n\n\n**Steps to "
          @"reproduce**\n\n\n---\nWing %@ · Chromium %@ · macOS %ld.%ld.%ld",
          [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"],
          ArdiaCoreEngine.sharedEngine.chromiumVersion, (long)os.majorVersion,
          (long)os.minorVersion, (long)os.patchVersion];
  NSURLComponents *url = [NSURLComponents
      componentsWithString:@"https://github.com/virajbhartiya/wing/issues/new"];
  url.queryItems = @[ [NSURLQueryItem queryItemWithName:@"body" value:body] ];
  [NSWorkspace.sharedWorkspace openURL:url.URL];
}
- (void)showCrashReports:(id)sender {
  NSURL *logs = [NSFileManager.defaultManager URLForDirectory:NSLibraryDirectory
                                                     inDomain:NSUserDomainMask
                                            appropriateForURL:nil
                                                       create:NO
                                                        error:nil];
  [NSWorkspace.sharedWorkspace
      openURL:[logs URLByAppendingPathComponent:@"Logs/DiagnosticReports"]];
}
// The engine's profile deletion ends the app when it targets the last-used
// profile, so removed profiles are queued and deleted before the next launch
// loads anything.
- (NSString *)deletedProfilesPath {
  return [_workspacePath.stringByDeletingLastPathComponent
      stringByAppendingPathComponent:@"wing-deleted-profiles.json"];
}
- (NSArray *)deletedProfiles {
  NSData *saved = [NSData dataWithContentsOfFile:self.deletedProfilesPath];
  id list = saved ? [NSJSONSerialization JSONObjectWithData:saved
                                                    options:0
                                                      error:nil]
                  : nil;
  return [list isKindOfClass:NSArray.class] ? list : @[];
}
- (BOOL)saveDeletedProfiles:(NSArray *)list {
  NSData *body = [NSJSONSerialization dataWithJSONObject:list
                                                 options:0
                                                   error:nil];
  return body && SaveWorkspace(body, self.deletedProfilesPath);
}
- (void)deleteProfileData:(NSString *)identity reply:(NSNumber *)rid {
  for (ArdiaCoreTab *tab in @[
         _serviceTabs[identity] ?: (id)NSNull.null,
         _extensionManagers[identity] ?: (id)NSNull.null
       ])
    if ([tab isKindOfClass:ArdiaCoreTab.class]) {
      tab.delegate = nil;
      [tab closeNow];
    }
  [_serviceTabs removeObjectForKey:identity];
  [_extensionManagers removeObjectForKey:identity];
  [_serviceURLs removeObjectForKey:identity];
  [_profiles removeObjectForKey:identity];
  NSMutableArray *queued = [self.deletedProfiles mutableCopy];
  if (![queued containsObject:identity])
    [queued addObject:identity];
  if ([self saveDeletedProfiles:queued])
    [self reply:rid result:@YES error:nil];
  else
    [self reply:rid result:nil error:@"Profile could not be queued."];
}
- (void)rollbackImportProfile:(NSString *)identity
                   completion:(WingImportReply)completion {
  if (![_importProfiles containsObject:identity] || _importCommitted) {
    completion(@YES, nil);
    return;
  }
  ArdiaCoreProfile *profile = _profiles[identity];
  for (ArdiaCoreTab *tab in @[
         _serviceTabs[identity] ?: (id)NSNull.null,
         _extensionManagers[identity] ?: (id)NSNull.null
       ])
    if ([tab isKindOfClass:ArdiaCoreTab.class]) {
      tab.delegate = nil;
      [tab closeNow];
    }
  [_serviceTabs removeObjectForKey:identity];
  [_extensionManagers removeObjectForKey:identity];
  [_serviceURLs removeObjectForKey:identity];
  [_profiles removeObjectForKey:identity];
  if (!profile) {
    completion(@YES, nil);
    return;
  }
  [ArdiaCoreEngine.sharedEngine
      deleteProfile:profile
         completion:^(BOOL deleted) {
           completion(@(deleted), deleted ? nil
                                          : @"Import rollback could not remove "
                                            @"its temporary profile.");
         }];
}
- (void)handleImportRequest:(NSDictionary *)request
                      reply:(WingImportReply)reply {
  NSDictionary *data = request[@"data"];
  NSString *operation = request[@"operation"];
  if ([operation isEqual:@"persist"]) {
    NSDictionary *proposed = data[@"state"];
    if (!ValidSync(@{@"workspace" : proposed ?: @{}, @"panes" : @[]})) {
      reply(nil, @"Invalid imported workspace.");
      return;
    }
    NSString *target = data[@"target"];
    if (!Identifier(target) || [target isEqual:@"default"] ||
        [target isEqual:@"work"]) {
      reply(nil, @"Unexpected import profile set.");
      return;
    }
    for (NSDictionary *profile in proposed[@"profiles"])
      if (![_importExistingProfiles containsObject:profile[@"id"]] &&
          ![profile[@"id"] isEqual:target]) {
        reply(nil, @"Unexpected import profile set.");
        return;
      }
    NSMutableSet *targetSpaces = [NSMutableSet new];
    for (NSDictionary *space in proposed[@"spaces"])
      if ([space[@"profileId"] isEqual:target])
        [targetSpaces addObject:space[@"id"]];
    NSMutableDictionary *merged = [_lastSync[@"workspace"] mutableCopy];
    NSMutableSet *newTabs = [NSMutableSet new];
    NSSet *currentTabs = [NSSet setWithArray:[merged[@"tabs"] valueForKey:@"id"]];
    for (NSDictionary *tab in proposed[@"tabs"])
      if ([targetSpaces containsObject:tab[@"spaceId"]] &&
          ![currentTabs containsObject:tab[@"id"]])
        [newTabs addObject:tab[@"id"]];
    for (NSString *key in
         @[ @"profiles", @"spaces", @"tabs", @"folders", @"history", @"archive", @"splits" ]) {
      NSMutableArray *rows = [merged[key] mutableCopy];
      NSSet *current = [NSSet setWithArray:[rows valueForKey:@"id"]];
      for (NSDictionary *row in proposed[key]) {
        if ([current containsObject:row[@"id"]])
          continue;
        BOOL include = [key isEqual:@"splits"]
                           ? [[NSSet setWithArray:row[@"tabIds"] ?: @[]] isSubsetOfSet:newTabs]
                       : [key isEqual:@"profiles"]
                           ? [row[@"id"] isEqual:target]
                       : [key isEqual:@"spaces"] || [key isEqual:@"history"]
                           ? [row[@"profileId"] isEqual:target]
                           : [targetSpaces containsObject:row[@"spaceId"]];
        if (include)
          [rows addObject:row];
      }
      if ([key isEqual:@"history"] && rows.count > 10000)
        [rows removeObjectsInRange:NSMakeRange(0, rows.count - 10000)];
      merged[key] = rows;
    }
    merged[@"activeSpaceId"] = proposed[@"activeSpaceId"];
    merged[@"activeTabId"] = proposed[@"activeTabId"];
    if (!ValidSync(@{@"workspace" : merged, @"panes" : @[]})) {
      reply(nil, @"Imported workspace exceeds browser limits.");
      return;
    }
    [self backupWorkspace:[NSData dataWithContentsOfFile:_workspacePath] force:YES];
    NSData *body = [NSJSONSerialization dataWithJSONObject:merged
                                                   options:0
                                                     error:nil];
    if (!SaveWorkspace(body, _workspacePath)) {
      reply(nil, @"Imported workspace could not be saved.");
      return;
    }
    _importCommitted = YES;
    NSMutableDictionary *sync = [_lastSync mutableCopy];
    sync[@"workspace"] = merged;
    _lastSync = sync;
    [self send:@"workspace-imported" data:merged];
    reply(@YES, nil);
    return;
  }
  NSString *profileId = data[@"profile"];
  if ([operation isEqual:@"rollback"]) {
    [self rollbackImportProfile:profileId completion:reply];
    return;
  }
  [self
      importProfile:profileId
              ready:^(ArdiaCoreProfile *profile, NSString *error) {
                if (error) {
                  reply(nil, error);
                  return;
                }
                if ([operation isEqual:@"cookie"]) {
                  NSNumber *rid = @(--self->_hostSequence);
                  self->_hostReplies[rid] = [reply copy];
                  [self service:@{
                    @"method" : @"import-cookie",
                    @"args" : @{@"cookie" : data[@"cookie"] ?: @{}}
                  }
                        profile:profileId
                          reply:rid
                       attempts:400];
                } else if ([operation isEqual:@"passwords"]) {
                  if (![profile
                          respondsToSelector:@selector(
                                                 importLogins:completion:)]) {
                    reply(nil, @"Saved-password import requires Wing's "
                               @"source-built engine.");
                    return;
                  }
                  if (![data[@"credentials"] isKindOfClass:NSArray.class]) {
                    reply(nil, @"Invalid password import.");
                    return;
                  }
                  [profile importLogins:data[@"credentials"]
                             completion:^(NSInteger count, NSString *error) {
                               reply(@(count), error);
                             }];
                } else if ([operation isEqual:@"flush-cookies"]) {
                  if ([profile
                          respondsToSelector:@selector(
                                                 flushCookiesWithCompletion:)])
                    [profile flushCookiesWithCompletion:^{
                      reply(@YES, nil);
                    }];
                  else
                    reply(@YES, nil);
                } else
                  reply(nil, @"Unknown import operation.");
              }];
}
// Per-window collections, shared by the main and private hosts.
- (void)prepareState {
  _tabs = [NSMutableDictionary new];
  _extensionPanel = [WingExtensionPanel new];
  _extensionSidebar = [WingExtensionSidebar new];
  __weak WingChromiumHost *sidebarHost = self;
  _extensionSidebar.onClose = ^{
    dispatch_async(dispatch_get_main_queue(), ^{
      [sidebarHost applyLayout];
      [sidebarHost focusAfterExtensionChange];
    });
  };
  _serviceTabs = [NSMutableDictionary new];
  _serviceURLs = [NSMutableDictionary new];
  _extensionManagers = [NSMutableDictionary new];
  _permissionAlerts = [NSMutableDictionary new];
  _externalAppAlerts = [NSMutableDictionary new];
  _deviceChoosers = [NSMutableDictionary new];
  _appliedStyles = [NSMutableDictionary new];
  _processSamples = [NSMutableDictionary new];
  _hostReplies = [NSMutableDictionary new];
  _profiles = [NSMutableDictionary new];
  _modelURLs = [NSMutableDictionary new];
  _closing = [NSMutableDictionary new];
  _freezeGenerations = [NSMutableDictionary new];
  _loadingProfiles = [NSMutableSet new];
  _capturingTabs = [NSMutableSet new];
  _pictureInPictureTabs = [NSMutableSet new];
  _miniPlayerTabs = [NSMutableSet new];
  _webkitPages = [NSMutableDictionary new];
  _crashedTabs = [NSMutableDictionary new];
  _hangPrompts = [NSMutableDictionary new];
  _screenSharingTabs = [NSMutableSet new];
  _wakingTabs = [NSMutableSet new];
  _departures = [NSMutableDictionary new];
  _pendingCreatedTabs = [NSMutableSet new];
  _protectedProfiles = [NSMutableSet new];
  _checkingProtection = [NSMutableSet new];
  _startingProtection = [NSMutableSet new];
  _protectionTabs = [NSMutableDictionary new];
  _protectionDeadlines = [NSMutableDictionary new];
  _protectionURLs = [NSMutableDictionary new];
}
// The window, its transparent shell and the observers that follow it.
- (void)buildWindow {
  _window = [[ArdiaCoreWindow alloc]
      initWithContentRect:NSMakeRect(100, 100, 1200, 800)];
  _window.delegate = self;
  _window.window.title = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleName"];
  // Arc-style chrome: the web shell draws to the top edge and the traffic
  // lights sit inside the sidebar header, centred on the toolbar row.
  _window.window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  _window.window.titlebarAppearsTransparent = YES;
  _window.window.titleVisibility = NSWindowTitleHidden;
  _window.window.tabbingMode = NSWindowTabbingModeDisallowed;
  if (!_private) [_window.window setFrameAutosaveName:@"WingMainWindow"];
  // A saved frame can point at a display that is no longer attached.
  BOOL visible = NO;
  for (NSScreen *screen in NSScreen.screens)
    visible = visible || NSIntersectsRect(
                             NSInsetRect(screen.visibleFrame, 40, 40),
                             _window.window.frame);
  if (!visible) [_window.window center];
  _uiWindow =
      [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1200, 800)];
  _uiWindow.internal = YES;
  _uiWindow.window.excludedFromWindowsMenu = YES;
  _uiWindow.delegate = self;
  _shell = [_uiWindow openTab:_shellURL
                      profile:ArdiaCoreEngine.sharedEngine.defaultProfile
                   foreground:YES];
  _shell.delegate = self;
  // Native sidebar material behind a transparent shell, tinted by CSS.
  NSVisualEffectView *material =
      [[NSVisualEffectView alloc] initWithFrame:_window.hostView.bounds];
  material.material = NSVisualEffectMaterialSidebar;
  material.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  material.state = NSVisualEffectStateFollowsWindowActiveState;
  material.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_window.hostView addSubview:material];
  _shell.pageBackgroundColor = NSColor.clearColor;
  _shell.contentsBackgroundColor = NSColor.clearColor;
  [_window.hostView addSubview:_shell.view];
  _shell.view.frame = _window.hostView.bounds;
  _shell.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_shell noteShownByHost:YES];
  __weak WingChromiumHost *weakSelf = self;
  _resizeObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowDidResizeNotification
                  object:_window.window
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                [weakSelf layoutTrafficLights];
                [weakSelf send:@"resize" data:@{}];
              }];
  _observers = [NSMutableArray new];
  for (NSNotificationName name in @[ NSWindowDidExitFullScreenNotification,
                                     NSWindowDidBecomeKeyNotification,
                                     NSWindowDidResignKeyNotification ])
    [_observers addObject:[NSNotificationCenter.defaultCenter
        addObserverForName:name
                    object:_window.window
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(NSNotification *note) {
                  [weakSelf layoutTrafficLights];
                }]];
  // Auto follows the Mac, whose Light/Dark switch rebuilds the title bar too.
  _themeObserver = [NSDistributedNotificationCenter.defaultCenter
      addObserverForName:@"AppleInterfaceThemeChangedNotification"
                  object:nil
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                [weakSelf relayoutTrafficLightsSoon];
              }];
  [_observers addObject:[NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowDidEnterFullScreenNotification
                  object:_window.window
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                [weakSelf send:@"window-state" data:@{@"fullScreen" : @YES}];
                [weakSelf applyLayout];
              }]];
  [_observers addObject:[NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowWillExitFullScreenNotification
                  object:_window.window
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                [weakSelf send:@"window-state" data:@{@"fullScreen" : @NO}];
                [weakSelf windowWillLeaveFullScreen];
              }]];
  for (NSNotificationName name in @[ NSApplicationDidBecomeActiveNotification,
                                     NSApplicationDidResignActiveNotification ])
    [_observers addObject:[NSNotificationCenter.defaultCenter
        addObserverForName:name
                    object:NSApp
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(NSNotification *note) {
                  [weakSelf applicationActiveChanged:[note.name isEqual:NSApplicationDidBecomeActiveNotification]];
                }]];
  // The shell asks for a window drag after mousedown on empty chrome; keep
  // the originating event so AppKit can run its native move loop.
  _mouseDownMonitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
                                   handler:^NSEvent *(NSEvent *event) {
                                     WingChromiumHost *host = weakSelf;
                                     if (host && event.window == host->_window.window)
                                       host->_lastMouseDown = event;
                                     return event;
                                   }];
}
- (void)engineDidStart {
  gMainHost = self;
  [self prepareState];
  _externalURLs = [NSMutableArray new];
  [NSAppleEventManager.sharedAppleEventManager
      setEventHandler:self
          andSelector:@selector(handleOpenURL:reply:)
        forEventClass:'GURL'
           andEventID:'GURL'];
  [ArdiaCoreEngine setAutoPictureInPicture:NO];
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  // The engine default profile is reserved for trusted UI. Website profiles
  // are loaded separately, including Wing's "default" browsing profile.
  _workspacePath = [@(getenv("WING_PROFILE_ROOT"))
      stringByAppendingPathComponent:@"wing-workspace.json"];
  _shellURL = [NSURL fileURLWithPath:[NSBundle.mainBundle.resourcePath
                                         stringByAppendingPathComponent:
                                             @"shell/index.html"]]
                  .absoluteString;
  engine.pageScript = [NSString
      stringWithFormat:
          @"(post)=>{if(window!==top)return()=>{};if(location.protocol==='"
          @"chrome-extension:'&&location.pathname==='/"
          @"control.html'){Object.defineProperty(window,'__wingServicePost',{"
          @"value:post});return()=>{};}if(location.href!==%@)return()=>{};"
          @"Object."
          @"defineProperty(window,'__wingNativePost',{value:post});return(kind,"
          @"json)=>{if(kind==='wing-native')window.dispatchEvent(new "
          @"CustomEvent('wing-native',{detail:JSON.parse(json)}));}}",
          JSON(_shellURL)];
  [self buildWindow];
  [NSAppleEventManager.sharedAppleEventManager
      setEventHandler:self
          andSelector:@selector(handleReopen:reply:)
        forEventClass:kCoreEventClass
           andEventID:kAEReopenApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [_window showInactive];
  [_window.window makeKeyAndOrderFront:nil];
  [self layoutTrafficLights];
  [self installMenus];
  [_shell focus];
  __weak WingChromiumHost *weakSelf = self;
  _maintenanceTimer =
      [NSTimer scheduledTimerWithTimeInterval:60
                                      repeats:YES
                                        block:^(NSTimer *timer) {
                                          [weakSelf archiveIdlePagesAt:NSDate.date.timeIntervalSince1970 * 1000
                                                        completion:^{ }];
                                        }];
  [self watchMemoryPressure];
  _modifierObserver = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged | NSEventMaskKeyDown |
                                           NSEventMaskLeftMouseDown | NSEventMaskScrollWheel
                                   handler:^NSEvent *(NSEvent *event) {
                                     WingChromiumHost *host = [WingChromiumHost keyHost];
                                     if (!host)
                                       return event;
                                     // Clicking the preview card opens its link in a Peek.
                                     if (event.type == NSEventTypeLeftMouseDown && host->_hoverCard &&
                                         event.window == host->_window.window &&
                                         NSPointInRect([host->_hoverCard convertPoint:event.locationInWindow fromView:nil],
                                                       host->_hoverCard.bounds)) {
                                       [host promoteHoverCard];
                                       return nil;
                                     }
                                     // Any other input cancels a pending Shift-hover preview.
                                     NSUInteger generation = ++gHoverPeekGeneration;
                                     if (event.type == NSEventTypeKeyDown && host->_hoverCard)
                                       [host closeHoverCard];
                                     if (event.type != NSEventTypeFlagsChanged)
                                       return event;
                                     NSEventModifierFlags flags =
                                         event.modifierFlags &
                                         (NSEventModifierFlagShift | NSEventModifierFlagControl |
                                          NSEventModifierFlagOption | NSEventModifierFlagCommand);
                                     if (!(flags & NSEventModifierFlagControl))
                                       [host send:@"action" data:@{@"name" : @"recent-tabs-commit"}];
                                     if (flags != NSEventModifierFlagShift) {
                                       [host closeHoverCard];
                                       return event;
                                     }
                                     dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC),
                                                    dispatch_get_main_queue(), ^{
                                                      if (generation == gHoverPeekGeneration)
                                                        [[WingChromiumHost keyHost] previewHoveredLink];
                                                    });
                                     return event;
                                   }];
}
// Holding Shift over a link shows a small live preview card beside it while
// Shift is held. Clicking the card opens the link in a Peek.
- (void)previewHoveredLink {
  if (_quitting || !_window.window.isKeyWindow || _hoverCard)
    return;
  NSPoint mouse = _window.window.mouseLocationOutsideOfEventStream;
  for (NSDictionary *pane in _lastSync[@"panes"]) {
    ArdiaCoreTab *page = _tabs[pane[@"id"]];
    if (!page || page.view.hidden || !page.view.superview ||
        !NSPointInRect([page.view convertPoint:mouse fromView:nil], page.view.bounds))
      continue;
    for (NSDictionary *record in _lastSync[@"workspace"][@"tabs"])
      if ([record[@"id"] isEqual:pane[@"id"]] && [record[@"transient"] boolValue])
        return;
    [page.profile warmSpareRenderer];
    [page evaluate:@"post('result',JSON.stringify((()=>{const a=[...document.querySelectorAll('a[href]:hover')].pop();"
                   @"return a&&/^https?:/.test(a.href)&&a.href!==location.href?a.href:''})()))"
        completion:^(NSString *raw) {
          id value = raw ? Parse(raw) : nil;
          if ([value isKindOfClass:NSString.class] && [value hasPrefix:@"\""])
            value = Parse(value);
          if ([value isKindOfClass:NSString.class] && [value hasPrefix:@"http"] &&
              ([NSEvent modifierFlags] & NSEventModifierFlagShift) && !self->_hoverCard)
            [self showHoverCard:value profile:page.profile at:mouse];
        }];
    return;
  }
}
- (void)showHoverCard:(NSString *)url profile:(ArdiaCoreProfile *)profile at:(NSPoint)mouse {
  NSView *host = _window.hostView;
  NSPoint point = [host convertPoint:mouse fromView:nil];
  NSSize size = NSMakeSize(MIN(520, NSWidth(host.bounds) - 32), MIN(360, NSHeight(host.bounds) - 32));
  // Beside the pointer, below it when there's room, kept inside the window.
  CGFloat x = MIN(MAX(16, point.x + 14), NSWidth(host.bounds) - size.width - 16);
  CGFloat below = host.isFlipped ? point.y + 18 : point.y - 18 - size.height;
  CGFloat above = host.isFlipped ? point.y - 18 - size.height : point.y + 18;
  BOOL fitsBelow = host.isFlipped ? below + size.height <= NSHeight(host.bounds) - 16 : below >= 16;
  CGFloat y = MIN(MAX(16, fitsBelow ? below : above), NSHeight(host.bounds) - size.height - 16);
  NSView *card = [[NSView alloc] initWithFrame:NSMakeRect(x, y, size.width, size.height)];
  card.wantsLayer = YES;
  card.layer.shadowOpacity = 0.28;
  card.layer.shadowRadius = 18;
  card.layer.shadowOffset = CGSizeMake(0, -6);
  NSView *clip = [[NSView alloc] initWithFrame:card.bounds];
  clip.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  clip.wantsLayer = YES;
  clip.layer.cornerRadius = 12;
  clip.layer.cornerCurve = @"continuous";
  clip.layer.masksToBounds = YES;
  clip.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
  clip.layer.borderWidth = 0.5;
  clip.layer.borderColor = [NSColor.labelColor colorWithAlphaComponent:0.15].CGColor;
  NSTextField *label = [NSTextField labelWithString:[NSURL URLWithString:url].host ?: url];
  label.textColor = NSColor.secondaryLabelColor;
  label.frame = NSMakeRect(16, (NSHeight(clip.bounds) - 20) / 2, NSWidth(clip.bounds) - 32, 20);
  label.alignment = NSTextAlignmentCenter;
  [clip addSubview:label];
  [card addSubview:clip];
  ArdiaCoreTab *preview = [_window openTab:url profile:profile foreground:NO];
  preview.view.frame = clip.bounds;
  preview.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [clip addSubview:preview.view];
  preview.view.hidden = NO;
  [preview noteShownByHost:YES];
  card.alphaValue = 0;
  [host addSubview:card positioned:NSWindowAbove relativeTo:nil];
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = 0.14;
    card.animator.alphaValue = 1;
  }];
  _hoverCard = card;
  _hoverTab = preview;
  _hoverURL = url;
}
- (void)closeHoverCard {
  if (!_hoverCard)
    return;
  NSView *card = _hoverCard;
  ArdiaCoreTab *preview = _hoverTab;
  _hoverCard = nil;
  _hoverTab = nil;
  _hoverURL = nil;
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = 0.1;
    card.animator.alphaValue = 0;
  } completionHandler:^{
    [card removeFromSuperview];
    preview.delegate = nil;
    [preview closeNow];
  }];
}
- (void)promoteHoverCard {
  NSString *url = _hoverURL;
  [self closeHoverCard];
  if (url)
    [self send:@"action" data:@{@"name" : @"peek", @"args" : @{@"url" : url}}];
}
// The host whose window is in front: menus, shortcuts and Control-Tab go there.
// Key status alone is not enough, since no window is key while Wing is behind.
+ (WingChromiumHost *)keyHost {
  NSWindow *front = NSApp.keyWindow;
  if (!front)
    for (NSWindow *window in NSApp.orderedWindows)
      if (window.visible && ![window isKindOfClass:NSPanel.class] && window.canBecomeMainWindow) {
        front = window;
        break;
      }
  for (WingChromiumHost *host in gPrivateHosts)
    if (front && host->_window.window == front) return host;
  return gMainHost;
}
// Engine-wide callbacks reach the main host; pages may belong to a private one.
+ (WingChromiumHost *)hostForTab:(ArdiaCoreTab *)tab {
  for (WingChromiumHost *host in gPrivateHosts)
    if ([host identityForTab:tab]) return host;
  return gMainHost;
}
- (instancetype)initPrivateWithProfile:(ArdiaCoreProfile *)profile
                              settings:(NSDictionary *)settings {
  if (!(self = [super init])) return nil;
  _private = YES;
  [self prepareState];
  _externalURLs = [NSMutableArray new];
  _shellURL = gMainHost->_shellURL;
  _profiles[@"private"] = profile;
  gLastPrivateProfile = profile;
  _privateSettings = settings ?: @{};
  [self buildWindow];
  NSWindow *window = _window.window;
  window.title = @"Private Browsing";
  window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  NSWindow *parent = [WingChromiumHost keyHost]->_window.window;
  if (parent.visible) {
    [window setFrame:parent.frame display:NO];
    [window setFrameTopLeftPoint:[window cascadeTopLeftFromPoint:NSMakePoint(
                                                                     NSMinX(parent.frame),
                                                                     NSMaxY(parent.frame))]];
  } else
    [window center];
  [_window showInactive];
  [window makeKeyAndOrderFront:nil];
  [self layoutTrafficLights];
  [_shell focus];
  return self;
}
// Closing a private window drops its pages; the last one takes the profile with it.
- (void)closePrivateWindow {
  _quitting = YES;
  for (ArdiaCoreTab *page in [_tabs.allValues arrayByAddingObjectsFromArray:_protectionTabs.allValues]) {
    page.delegate = nil;
    if (!page.closed) [page closeNow];
  }
  [_tabs removeAllObjects];
  [_protectionTabs removeAllObjects];
  for (WingPromptPopover *prompt in _permissionAlerts.allValues) [prompt dismiss];
  for (WingPromptPopover *prompt in _hangPrompts.allValues) [prompt dismiss];
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [NSNotificationCenter.defaultCenter removeObserver:_resizeObserver];
  [NSDistributedNotificationCenter.defaultCenter removeObserver:_themeObserver];
  [NSEvent removeMonitor:_mouseDownMonitor];
  _observers = nil;
  _resizeObserver = _themeObserver = _mouseDownMonitor = nil;
  _shell.delegate = nil;
  ArdiaCoreWindow *ui = _uiWindow;
  _uiWindow.delegate = nil;
  dispatch_async(dispatch_get_main_queue(), ^{ [ui close]; });
  ArdiaCoreProfile *profile = _profiles[@"private"];
  [gPrivateHosts removeObject:self];
  BOOL shared = NO;
  for (WingChromiumHost *host in gPrivateHosts)
    shared = shared || host->_profiles[@"private"] == profile;
  if (profile && !shared)
    dispatch_async(dispatch_get_main_queue(), ^{
      [ArdiaCoreEngine.sharedEngine releaseProfile:profile];
    });
}
// Editors exist on most web apps, so an editable element only counts as unsaved
// once the user has typed in it and it still holds text. Sending a message
// empties the editor, which lets the page sleep again.
static NSString *const kTrackEditsScript =
    @"(()=>{const key=Symbol.for('wing.edited');if(window[key])return;"
    @"const edited=window[key]=new Set();addEventListener('input',e=>{"
    @"if(e.target&&e.target.isContentEditable)edited.add(e.target);},true);})()";
static NSString *const kHasUnsavedInputScript =
    @"post('result',JSON.stringify([...(window[Symbol.for('wing.edited')]||[])]."
    @"some(e=>e.isConnected&&e.textContent.trim())||[...document."
    @"querySelectorAll('input,textarea')].some(e=>e.value!==e.defaultValue||"
    @"e.checked!==e.defaultChecked)))";
- (BOOL)mayRetirePage:(ArdiaCoreTab *)page {
  NSString *identity = [self identityForTab:page];
  if (_quitting || !identity || page.closed || page.loading ||
      page.audible || (page.view.superview && !_departures[identity]) || page.devToolsView ||
      [_capturingTabs containsObject:identity] || [_pictureInPictureTabs containsObject:identity])
    return NO;
  NSDictionary *state = _lastSync[@"workspace"];
  NSString *active = state[@"activeTabId"];
  if ([identity isEqual:active])
    return NO;
  for (NSDictionary *split in state[@"splits"])
    if ([split[@"tabIds"] containsObject:active] &&
        [split[@"tabIds"] containsObject:identity])
      return NO;
  for (NSDictionary *record in state[@"tabs"])
    if ([record[@"id"] isEqual:identity] && [record[@"transient"] boolValue])
      return NO;
  return YES;
}
// Background pages freeze a minute after they leave the screen: timers and
// animation stop but the document stays, so returning is instant, not a reload.
// Pages are only discarded (and reload on return) when macOS is short of memory.
static NSArray<NSString *> *const kAlwaysAwakeHosts = @[
  @"mail.google.com", @"calendar.google.com", @"app.slack.com", @"web.whatsapp.com",
  @"discord.com", @"teams.microsoft.com", @"teams.live.com", @"outlook.office.com",
  @"outlook.live.com", @"web.telegram.org", @"messages.google.com"
];
- (BOOL)mayFreezePage:(ArdiaCoreTab *)page {
  NSString *host = [NSURL URLWithString:page.url].host.lowercaseString ?: @"";
  for (NSString *awake in kAlwaysAwakeHosts)
    if ([host isEqual:awake] || [host hasSuffix:[@"." stringByAppendingString:awake]])
      return NO;
  return !page.frozen && !page.discarded && [self mayRetirePage:page] &&
         ![_screenSharingTabs containsObject:[self identityForTab:page]];
}
- (void)scheduleFreeze:(NSString *)identity {
  NSNumber *generation = @(_freezeGenerations[identity].integerValue + 1);
  _freezeGenerations[identity] = generation;
  __weak WingChromiumHost *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    WingChromiumHost *host = weakSelf;
    ArdiaCoreTab *page = host ? host->_tabs[identity] : nil;
    if (page && [host->_freezeGenerations[identity] isEqual:generation] &&
        [host mayFreezePage:page]) {
      page.frozen = YES;
      [host pageChanged:page];
    }
  });
}
// Anything that runs script in, shows or closes a page wakes it first; a hidden
// page goes back to sleep a minute later.
- (void)thaw:(ArdiaCoreTab *)page {
  NSString *identity = page ? [self identityForTab:page] : nil;
  if (!identity || !page.frozen) return;
  page.frozen = NO;
  [self pageChanged:page];
  if (!page.view.superview) [self scheduleFreeze:identity];
}
- (void)watchMemoryPressure {
  _memoryPressure = dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
                                           DISPATCH_MEMORYPRESSURE_CRITICAL,
                                           dispatch_get_main_queue());
  __weak WingChromiumHost *weakSelf = self;
  dispatch_source_set_event_handler(_memoryPressure, ^{
    WingChromiumHost *host = weakSelf;
    if (!host) return;
    // macOS warns often during ordinary heavy use; only a critical shortage is
    // worth a reload, and then only for pages over the budget or long idle.
    [host trimMemoryAutomatic:YES completion:^{
    }];
  });
  dispatch_resume(_memoryPressure);
}
- (BOOL)mayDiscardPage:(ArdiaCoreTab *)page {
  return !page.discarded && [self mayRetirePage:page];
}
- (BOOL)isArchiveCandidate:(NSString *)identity at:(double)now {
  NSDictionary *state = _lastSync[@"workspace"];
  double hours = [state[@"settings"][@"archiveHours"] doubleValue];
  if (hours <= 0 || _quitting || [identity isEqual:state[@"activeTabId"]])
    return NO;
  for (NSDictionary *split in state[@"splits"])
    if ([split[@"tabIds"] containsObject:state[@"activeTabId"]] &&
        [split[@"tabIds"] containsObject:identity])
      return NO;
  for (NSDictionary *record in state[@"tabs"])
    if ([record[@"id"] isEqual:identity])
      return [record[@"kind"] isEqual:@"today"] &&
             ![record[@"transient"] boolValue] &&
             now - [record[@"lastActive"] doubleValue] > hours * 3600000;
  return NO;
}
- (void)archiveIdlePagesAt:(double)now completion:(void (^)(void))completion {
  dispatch_group_t group = dispatch_group_create();
  // Restored background destinations can be idle without ever creating a
  // native page. They have no live document or beforeunload state to protect.
  for (NSDictionary *record in _lastSync[@"workspace"][@"tabs"]) {
    NSString *identity = record[@"id"];
    if (!_tabs[identity] && [self isArchiveCandidate:identity at:now])
      [self send:@"closed" data:@{@"id" : identity, @"archive" : @YES}];
  }
  for (NSString *identity in _tabs.allKeys) {
    ArdiaCoreTab *page = _tabs[identity];
    if (![self isArchiveCandidate:identity at:now] ||
        ![self mayRetirePage:page] || _closing[identity])
      continue;
    void (^closeIfEligible)(void) = ^{
      // Selection, settings, or document state may change during evaluation.
      if ([self isArchiveCandidate:identity at:now] &&
          [self mayRetirePage:page] && !_closing[identity]) {
        _closing[identity] = @YES;
        [page close]; // Keep Chromium's beforeunload cancellation semantics.
      }
    };
    if (page.discarded) {
      closeIfEligible();
      continue;
    }
    dispatch_group_enter(group);
    [self thaw:page];
    [page evaluate:kHasUnsavedInputScript
        completion:^(NSString *raw) {
          id value = raw ? Parse(raw) : nil;
          if ([value isKindOfClass:NSString.class])
            value = Parse(value);
          if ([value isKindOfClass:NSNumber.class] && ![value boolValue])
            closeIfEligible();
          dispatch_group_leave(group);
        }];
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), completion);
}
- (void)trimMemoryAutomatic:(BOOL)automatic
                 completion:(void (^)(void))completion {
  if (automatic && _automaticTrimRunning) {
    completion();
    return;
  }
  _automaticTrimRunning = _automaticTrimRunning || automatic;
  NSArray *records = [_lastSync[@"workspace"][@"tabs"]
      sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,
                                                     NSDictionary *b) {
        return [a[@"lastActive"] compare:b[@"lastActive"]];
      }];
  NSInteger remaining = 0;
  for (ArdiaCoreTab *page in _tabs.allValues)
    if (!page.discarded && !page.closed)
      remaining++;
  [self discardFrom:records
              index:0
          remaining:remaining
              limit:[_lastSync[@"workspace"][@"settings"][@"maxLiveTabs"]
                        integerValue] ?: 4
          automatic:automatic
         completion:^{
           if (automatic)
             self->_automaticTrimRunning = NO;
           completion();
         }];
}
// Every page is asked about unsaved input at once; the budget is then applied
// oldest first, so it only counts pages that really slept.
- (void)discardFrom:(NSArray *)records
              index:(NSUInteger)index
          remaining:(NSInteger)remaining
              limit:(NSInteger)limit
          automatic:(BOOL)automatic
         completion:(void (^)(void))completion {
  double now = NSDate.date.timeIntervalSince1970 * 1000;
  NSMutableDictionary<NSString *, NSNumber *> *clean = [NSMutableDictionary new];
  dispatch_group_t group = dispatch_group_create();
  for (NSUInteger i = index; i < records.count; i++) {
    NSString *identity = records[i][@"id"];
    ArdiaCoreTab *page = _tabs[identity];
    BOOL idle = now - [records[i][@"lastActive"] doubleValue] > 300000;
    if (!page || clean[identity] || (automatic && !idle && remaining <= limit) ||
        ![self mayDiscardPage:page])
      continue;
    clean[identity] = @NO;
    __block BOOL settled = NO;
    void (^settle)(BOOL) = ^(BOOL answer) {
      if (settled)
        return;
      settled = YES;
      clean[identity] = @(answer);
      dispatch_group_leave(group);
    };
    dispatch_group_enter(group);
    [self thaw:page];
    [page evaluate:kHasUnsavedInputScript
        completion:^(NSString *raw) {
          id value = raw ? Parse(raw) : nil;
          if ([value isKindOfClass:NSString.class])
            value = Parse(value);
          settle([value isKindOfClass:NSNumber.class] && ![value boolValue]);
        }];
    // A hung renderer never answers; it must not stall the other pages.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
                     settle(NO);
                   });
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{
    NSInteger live = remaining;
    for (NSUInteger i = index; i < records.count; i++) {
      NSString *identity = records[i][@"id"];
      ArdiaCoreTab *page = self->_tabs[identity];
      BOOL idle = now - [records[i][@"lastActive"] doubleValue] > 300000;
      if (!page || ![clean[identity] boolValue] || (automatic && !idle && live <= limit))
        continue;
      if ([self mayDiscardPage:page] && [page discard])
        live--;
    }
    completion();
  });
}
// Menu items route through the same shell actions as keyboard shortcuts.
// Keys the engine reserves are consumed in preHandleKeyEvent before the menu
// sees them, so listing them here only makes them discoverable.
- (NSMenuItem *)menuItem:(NSString *)title
                     key:(NSString *)key
               modifiers:(NSEventModifierFlags)modifiers
                    kind:(NSString *)kind
                    data:(NSDictionary *)data {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                action:@selector(menuSend:)
                                         keyEquivalent:key ?: @""];
  item.keyEquivalentModifierMask = modifiers;
  item.target = self;
  item.representedObject = @{@"kind" : kind, @"data" : data ?: @{}};
  return item;
}
- (NSMenuItem *)action:(NSString *)title
                   key:(NSString *)key
             modifiers:(NSEventModifierFlags)modifiers
                  name:(NSString *)name
                  args:(NSDictionary *)args {
  return [self menuItem:title
                    key:key
              modifiers:modifiers
                   kind:@"action"
                   data:@{@"name" : name, @"args" : args ?: @{}}];
}
- (NSMenuItem *)command:(NSString *)title
                    key:(NSString *)key
              modifiers:(NSEventModifierFlags)modifiers
                   data:(NSDictionary *)data {
  return [self menuItem:title key:key modifiers:modifiers kind:@"command" data:data];
}
- (NSMenuItem *)system:(NSString *)title
              selector:(SEL)selector
                   key:(NSString *)key
             modifiers:(NSEventModifierFlags)modifiers {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                action:selector
                                         keyEquivalent:key ?: @""];
  item.keyEquivalentModifierMask = modifiers;
  return item;
}
- (void)menuSend:(NSMenuItem *)sender {
  NSDictionary *payload = sender.representedObject;
  NSDictionary *data = payload[@"data"];
  NSString *name = [payload[@"kind"] isEqual:@"action"] ? data[@"name"]
                   : [data[@"type"] isEqual:@"palette"]
                       ? [@"palette-" stringByAppendingString:data[@"mode"] ?: @"new"]
                       : nil;
  WingChromiumHost *target = [WingChromiumHost keyHost];
  if (target != self) {
    [target send:payload[@"kind"] data:payload[@"data"]];
    if ([payload[@"kind"] isEqual:@"command"]) [target->_shell focus];
    return;
  }
  if (name && [WingMiniWindow performMenuAction:name args:data[@"args"] ?: @{}])
    return;
  if (!_window.window.visible) [self showMainWindow:nil];
  [self send:payload[@"kind"] data:payload[@"data"]];
  if ([payload[@"kind"] isEqual:@"command"]) [_shell focus];
}
- (NSMenu *)addMenu:(NSString *)title to:(NSMenu *)bar {
  NSMenuItem *holder = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
  holder.submenu = menu;
  [bar addItem:holder];
  return menu;
}
- (void)installMenus {
  const NSEventModifierFlags cmd = NSEventModifierFlagCommand,
                             shift = NSEventModifierFlagShift,
                             option = NSEventModifierFlagOption,
                             control = NSEventModifierFlagControl;
  NSMenu *bar = [NSMenu new];
  NSString *name = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleName"] ?: @"Wing";

  NSMenu *app = [self addMenu:name to:bar];
  [app addItem:[self system:[@"About " stringByAppendingString:name]
                   selector:@selector(orderFrontStandardAboutPanel:)
                        key:nil modifiers:0]];
  [app addItem:NSMenuItem.separatorItem];
  [app addItem:[self command:@"Settings…" key:@"," modifiers:cmd data:@{@"type" : @"settings"}]];
  [app addItem:[self action:@"Set as Default Browser" key:nil modifiers:0 name:@"default-browser" args:nil]];
  [app addItem:NSMenuItem.separatorItem];
  NSMenuItem *services = [[NSMenuItem alloc] initWithTitle:@"Services" action:nil keyEquivalent:@""];
  services.submenu = [[NSMenu alloc] initWithTitle:@"Services"];
  NSApp.servicesMenu = services.submenu;
  [app addItem:services];
  [app addItem:NSMenuItem.separatorItem];
  [app addItem:[self system:[@"Hide " stringByAppendingString:name] selector:@selector(hide:) key:@"h" modifiers:cmd]];
  [app addItem:[self system:@"Hide Others" selector:@selector(hideOtherApplications:) key:@"h" modifiers:cmd | option]];
  [app addItem:[self system:@"Show All" selector:@selector(unhideAllApplications:) key:nil modifiers:0]];
  [app addItem:NSMenuItem.separatorItem];
  NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:[@"Quit " stringByAppendingString:name]
                                                action:@selector(quit:)
                                         keyEquivalent:@"q"];
  quit.target = self;
  [app addItem:quit];

  NSMenu *file = [self addMenu:@"File" to:bar];
  [file addItem:[self command:@"New Tab" key:@"t" modifiers:cmd data:@{@"type" : @"palette", @"mode" : @"new"}]];
  NSMenuItem *window = [[NSMenuItem alloc] initWithTitle:@"Show Main Window"
                                                  action:@selector(showMainWindow:)
                                           keyEquivalent:@"n"];
  window.target = self;
  [file addItem:window];
  NSMenuItem *privateWindow = [[NSMenuItem alloc] initWithTitle:@"New Private Window"
                                                         action:@selector(newPrivateWindow:)
                                                  keyEquivalent:@"n"];
  privateWindow.keyEquivalentModifierMask = cmd | shift;
  privateWindow.target = self;
  [file addItem:privateWindow];
  [file addItem:[self action:@"New Mini Window" key:@"n" modifiers:cmd | option name:@"mini-window" args:nil]];
  [file addItem:[self command:@"Open Location…" key:@"l" modifiers:cmd data:@{@"type" : @"palette", @"mode" : @"navigate"}]];
  [file addItem:NSMenuItem.separatorItem];
  [file addItem:[self action:@"Close Tab" key:@"w" modifiers:cmd name:@"close-tab" args:nil]];
  [file addItem:[self system:@"Close Window" selector:@selector(performClose:) key:@"w" modifiers:cmd | shift]];
  [file addItem:[self action:@"Reopen Closed Tab" key:@"t" modifiers:cmd | shift name:@"restore" args:nil]];
  [file addItem:NSMenuItem.separatorItem];
  [file addItem:[self command:@"New Space…" key:nil modifiers:0 data:@{@"type" : @"space-editor"}]];
  [file addItem:[self command:@"Import Browser Data…" key:nil modifiers:0 data:@{@"type" : @"import"}]];
  [file addItem:NSMenuItem.separatorItem];
  [file addItem:[self action:@"Save Page as PDF…" key:nil modifiers:0 name:@"save-pdf" args:nil]];
  [file addItem:[self action:@"Print…" key:@"p" modifiers:cmd name:@"print-page" args:nil]];

  NSMenu *edit = [self addMenu:@"Edit" to:bar];
  [edit addItem:[self system:@"Undo" selector:@selector(undo:) key:@"z" modifiers:cmd]];
  [edit addItem:[self system:@"Redo" selector:@selector(redo:) key:@"z" modifiers:cmd | shift]];
  [edit addItem:NSMenuItem.separatorItem];
  [edit addItem:[self system:@"Cut" selector:@selector(cut:) key:@"x" modifiers:cmd]];
  [edit addItem:[self system:@"Copy" selector:@selector(copy:) key:@"c" modifiers:cmd]];
  [edit addItem:[self system:@"Paste" selector:@selector(paste:) key:@"v" modifiers:cmd]];
  [edit addItem:[self system:@"Paste and Match Style" selector:@selector(pasteAndMatchStyle:) key:@"v" modifiers:cmd | shift | option]];
  [edit addItem:[self system:@"Delete" selector:@selector(delete:) key:nil modifiers:0]];
  [edit addItem:[self system:@"Select All" selector:@selector(selectAll:) key:@"a" modifiers:cmd]];
  [edit addItem:NSMenuItem.separatorItem];
  [edit addItem:[self action:@"Copy Page Address" key:@"c" modifiers:cmd | shift name:@"copy-url" args:nil]];
  NSMenuItem *findHolder = [[NSMenuItem alloc] initWithTitle:@"Find" action:nil keyEquivalent:@""];
  NSMenu *find = [[NSMenu alloc] initWithTitle:@"Find"];
  findHolder.submenu = find;
  [find addItem:[self command:@"Find…" key:@"f" modifiers:cmd data:@{@"type" : @"find"}]];
  [find addItem:[self command:@"Find Next" key:@"g" modifiers:cmd data:@{@"type" : @"find", @"step" : @1}]];
  [find addItem:[self command:@"Find Previous" key:@"g" modifiers:cmd | shift data:@{@"type" : @"find", @"step" : @(-1)}]];
  [find addItem:[self command:@"Use Selection for Find" key:@"e" modifiers:cmd data:@{@"type" : @"find", @"selection" : @YES}]];
  [edit addItem:findHolder];

  NSMenu *view = [self addMenu:@"View" to:bar];
  [view addItem:[self action:@"Toggle Sidebar" key:@"s" modifiers:cmd name:@"sidebar" args:nil]];
  [view addItem:NSMenuItem.separatorItem];
  [view addItem:[self action:@"Stop" key:@"." modifiers:cmd name:@"stop" args:nil]];
  [view addItem:[self action:@"Reload Page" key:@"r" modifiers:cmd name:@"reload" args:nil]];
  [view addItem:[self action:@"Hard Refresh" key:@"r" modifiers:cmd | shift name:@"dev-reload" args:nil]];
  [view addItem:NSMenuItem.separatorItem];
  [view addItem:[self action:@"Actual Size" key:@"0" modifiers:cmd name:@"zoom" args:@{@"reset" : @YES}]];
  [view addItem:[self action:@"Zoom In" key:@"+" modifiers:cmd name:@"zoom" args:@{@"delta" : @1}]];
  [view addItem:[self action:@"Zoom Out" key:@"-" modifiers:cmd name:@"zoom" args:@{@"delta" : @(-1)}]];
  [view addItem:NSMenuItem.separatorItem];
  [view addItem:[self command:@"Split View…" key:@"2" modifiers:cmd | shift data:@{@"type" : @"split-picker"}]];
  [view addItem:[self command:@"Show Reader" key:@"r" modifiers:cmd | option data:@{@"type" : @"reader"}]];
  [view addItem:[self action:@"Cast…" key:nil modifiers:0 name:@"cast" args:nil]];
  [view addItem:[self system:@"Enter Full Screen" selector:@selector(toggleFullScreen:) key:@"f" modifiers:cmd | control]];
  [view addItem:NSMenuItem.separatorItem];
  NSMenuItem *developerHolder = [[NSMenuItem alloc] initWithTitle:@"Developer" action:nil keyEquivalent:@""];
  NSMenu *developer = [[NSMenu alloc] initWithTitle:@"Developer"];
  developerHolder.submenu = developer;
  [developer addItem:[self action:@"Developer Tools" key:@"i" modifiers:cmd | option name:@"devtools" args:nil]];
  [developer addItem:[self command:@"Task Manager" key:nil modifiers:0 data:@{@"type" : @"performance"}]];
  [view addItem:developerHolder];

  NSMenu *develop = [self addMenu:@"Develop" to:bar];
  [develop addItem:[self action:@"Hard Refresh" key:nil modifiers:0 name:@"dev-reload" args:nil]];
  [develop addItem:[self action:@"Developer Tools" key:@"j" modifiers:cmd | option name:@"devtools" args:nil]];
  [develop addItem:[self action:@"View Page Source" key:@"u" modifiers:cmd | option name:@"dev-source" args:nil]];
  [develop addItem:[self action:@"Clear Data for This Site…" key:nil modifiers:0 name:@"dev-clear-site" args:nil]];
  [develop addItem:[self action:@"Pull Requests" key:nil modifiers:0 name:@"pulls-open" args:nil]];
  [develop addItem:NSMenuItem.separatorItem];
  [develop addItem:[self action:@"Toggle Cache" key:nil modifiers:0 name:@"dev" args:@{@"tool" : @"cache"}]];
  [develop addItem:[self action:@"Toggle JavaScript" key:nil modifiers:0 name:@"dev" args:@{@"tool" : @"javascript"}]];
  NSArray *devSubmenus = @[
    @[ @"Device Size", @"device", @[ @[ @"Window Size", NSNull.null ], @[ @"iPhone (390 × 844)", @"iphone" ], @[ @"iPad (820 × 1180)", @"ipad" ], @[ @"Laptop (1440 × 900)", @"laptop" ] ] ],
    @[ @"Color Scheme", @"scheme", @[ @[ @"System", NSNull.null ], @[ @"Light", @"light" ], @[ @"Dark", @"dark" ] ] ],
    @[ @"Network Speed", @"network", @[ @[ @"No Throttling", NSNull.null ], @[ @"Fast 3G", @"fast3g" ], @[ @"Slow 3G", @"slow3g" ], @[ @"Offline", @"offline" ] ] ],
    @[ @"User Agent", @"agent", @[ @[ @"Default", NSNull.null ], @[ @"Safari", @"safari" ], @[ @"Safari on iPhone", @"iphone" ], @[ @"Firefox", @"firefox" ] ] ],
  ];
  for (NSArray *group in devSubmenus) {
    NSMenuItem *holder = [[NSMenuItem alloc] initWithTitle:group[0] action:nil keyEquivalent:@""];
    NSMenu *choices = [[NSMenu alloc] initWithTitle:group[0]];
    holder.submenu = choices;
    for (NSArray *choice in group[2]) {
      NSMutableDictionary *args = [@{@"tool" : group[1]} mutableCopy];
      if (choice[1] != NSNull.null) args[@"value"] = choice[1];
      [choices addItem:[self action:choice[0] key:nil modifiers:0 name:@"dev" args:args]];
    }
    [develop addItem:holder];
  }
  [develop addItem:NSMenuItem.separatorItem];
  for (NSString *browser in @[ @"Safari", @"Google Chrome", @"Firefox" ])
    [develop addItem:[self action:[@"Open Page in " stringByAppendingString:browser]
                              key:nil
                        modifiers:0
                             name:@"dev-open-in"
                             args:@{@"browser" : browser}]];

  NSMenu *history = [self addMenu:@"History" to:bar];
  [history addItem:[self action:@"Back" key:@"[" modifiers:cmd name:@"back" args:nil]];
  [history addItem:[self action:@"Forward" key:@"]" modifiers:cmd name:@"forward" args:nil]];
  [history addItem:NSMenuItem.separatorItem];
  [history addItem:[self action:@"Show All History" key:@"y" modifiers:cmd name:@"new-tab" args:@{@"url" : @"wing://history"}]];
  [history addItem:[self command:@"Recent History" key:@"y" modifiers:cmd | shift data:@{@"type" : @"library", @"tab" : @"history"}]];
  [history addItem:[self command:@"Downloads" key:@"j" modifiers:cmd | shift data:@{@"type" : @"library", @"tab" : @"downloads"}]];
  [history addItem:[self command:@"Archive" key:nil modifiers:0 data:@{@"type" : @"library", @"tab" : @"archive"}]];
  [history addItem:NSMenuItem.separatorItem];
  [history addItem:[self action:@"Clear History…" key:nil modifiers:0 name:@"new-tab" args:@{@"url" : @"wing://clear-data"}]];

  NSMenu *spaces = [self addMenu:@"Spaces" to:bar];
  [spaces addItem:[self action:@"Previous Space" key:[NSString stringWithFormat:@"%C", (unichar)NSLeftArrowFunctionKey] modifiers:cmd | option name:@"swipe-profile" args:@{@"direction" : @(-1)}]];
  [spaces addItem:[self action:@"Next Space" key:[NSString stringWithFormat:@"%C", (unichar)NSRightArrowFunctionKey] modifiers:cmd | option name:@"swipe-profile" args:@{@"direction" : @1}]];
  [spaces addItem:NSMenuItem.separatorItem];
  for (int i = 1; i <= 9; i++)
    [spaces addItem:[self action:[NSString stringWithFormat:@"Profile %d", i]
                             key:[NSString stringWithFormat:@"%d", i]
                       modifiers:control
                            name:@"space-index"
                            args:@{@"index" : @(i - 1)}]];
  [spaces addItem:NSMenuItem.separatorItem];
  [spaces addItem:[self command:@"Edit Current Space…" key:nil modifiers:0 data:@{@"type" : @"space-editor"}]];

  NSMenu *tabs = [self addMenu:@"Tabs" to:bar];
  [tabs addItem:[self action:@"Pin / Unpin Tab" key:@"d" modifiers:cmd name:@"pin" args:nil]];
  [tabs addItem:[self action:@"Add to Favorites" key:nil modifiers:0 name:@"favorite" args:nil]];
  [tabs addItem:[self action:@"Mute Tab" key:nil modifiers:0 name:@"mute-tab" args:nil]];
  [tabs addItem:NSMenuItem.separatorItem];
  [tabs addItem:[self action:@"Show Next Tab" key:@"]" modifiers:cmd | shift name:@"cycle-tab" args:@{@"direction" : @1}]];
  [tabs addItem:[self action:@"Show Previous Tab" key:@"[" modifiers:cmd | shift name:@"cycle-tab" args:@{@"direction" : @(-1)}]];
  [tabs addItem:NSMenuItem.separatorItem];
  for (int i = 1; i <= 9; i++)
    [tabs addItem:[self action:i == 9 ? @"Last Tab" : [NSString stringWithFormat:@"Tab %d", i]
                           key:[NSString stringWithFormat:@"%d", i]
                     modifiers:cmd
                          name:@"tab-index"
                          args:@{@"index" : @(i == 9 ? -1 : i - 1)}]];
  [tabs addItem:NSMenuItem.separatorItem];
  [tabs addItem:[self action:@"Clear Today’s Tabs" key:nil modifiers:0 name:@"clear-today" args:nil]];

  NSMenu *windowMenu = [self addMenu:@"Window" to:bar];
  [windowMenu addItem:[self system:@"Minimize" selector:@selector(performMiniaturize:) key:@"m" modifiers:cmd]];
  [windowMenu addItem:[self system:@"Zoom" selector:@selector(performZoom:) key:nil modifiers:0]];
  [windowMenu addItem:NSMenuItem.separatorItem];
  [windowMenu addItem:[self system:@"Bring All to Front" selector:@selector(arrangeInFront:) key:nil modifiers:0]];
  NSApp.windowsMenu = windowMenu;

  NSMenu *help = [self addMenu:@"Help" to:bar];
  for (NSArray *entry in @[
         @[ @"Report a Problem…", @"reportProblem:" ],
         @[ @"Show Crash Reports", @"showCrashReports:" ]
       ]) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:entry[0]
                                                  action:NSSelectorFromString(entry[1])
                                           keyEquivalent:@""];
    item.target = self;
    [help addItem:item];
  }
  [help addItem:[self command:@"Wing Guide" key:@"/" modifiers:cmd | shift data:@{@"type" : @"help"}]];
  NSApp.helpMenu = help;
  NSApp.mainMenu = bar;
}
- (void)handleOpenURL:(NSAppleEventDescriptor *)event
                reply:(NSAppleEventDescriptor *)reply {
  NSString *url = [event paramDescriptorForKeyword:'----'].stringValue;
  NSURLComponents *parsed = [NSURLComponents componentsWithString:url ?: @""];
  NSString *space;
  // wingbrowser://open?url=…&space=… comes from the wing command-line tool.
  if ([parsed.scheme.lowercaseString isEqual:@"wingbrowser"]) {
    url = nil;
    for (NSURLQueryItem *item in parsed.queryItems) {
      if ([item.name isEqual:@"url"]) url = item.value;
      if ([item.name isEqual:@"space"]) space = item.value;
    }
    parsed = [NSURLComponents componentsWithString:url ?: @""];
  }
  if (![@[ @"http", @"https" ] containsObject:parsed.scheme.lowercaseString] ||
      !parsed.host.length)
    return;
  if (space.length) {
    if (!_externalSpaces) _externalSpaces = [NSMutableDictionary new];
    _externalSpaces[url] = space;
  }
  if (!_lastSync)
    [_externalURLs addObject:url];
  else
    [self send:@"action"
          data:@{
            @"name" : @"external-url",
            @"args" : @{@"url" : url, @"space" : space ?: @""}
          }];
  [_window.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}
- (void)quit:(id)sender {
  _quitting = YES;
  for (WingChromiumHost *host in gPrivateHosts) host->_quitting = YES;
  [ArdiaCoreEngine.sharedEngine quit];
}
- (void)engineQuitCancelled {
  _quitting = NO;
  [self applyLayout];
}
- (void)windowDidCancelClose:(ArdiaCoreWindow *)window {
  [self engineQuitCancelled];
}
- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window {
  if (_private) {
    if (window == _window && !_quitting && !gMainHost->_quitting) [self closePrivateWindow];
    return YES;
  }
  // Mac browsers keep running when the window closes; the Dock icon,
  // ⌘N or an opened link brings the same workspace back.
  if (window == _window && !_quitting) {
    [_window.window orderOut:nil];
    return NO;
  }
  return YES;
}
// Site prompts attach below the address field the shell last reported.
- (NSRect)promptAnchor {
  NSDictionary *anchor = _lastSync[@"anchor"];
  NSView *view = _window.hostView;
  CGFloat height = NSHeight(view.bounds);
  if (![anchor isKindOfClass:NSDictionary.class])
    return NSMakeRect(NSMidX(view.bounds) - 1, view.isFlipped ? 46 : height - 46, 2, 2);
  CGFloat x = [anchor[@"x"] doubleValue], y = [anchor[@"y"] doubleValue],
          w = [anchor[@"width"] doubleValue], h = [anchor[@"height"] doubleValue];
  return NSMakeRect(x, view.isFlipped ? y : height - y - h, MAX(w, 2), MAX(h, 2));
}
- (void)handleReopen:(NSAppleEventDescriptor *)event
               reply:(NSAppleEventDescriptor *)reply {
  [self showMainWindow:nil];
}
- (void)showMainWindow:(id)sender {
  [_window.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  [self layoutTrafficLights];
  [_shell focus];
}
// An appearance change rebuilds the title bar on a later pass, which puts the
// buttons back in AppKit's corner; place them again once that pass has run.
- (void)relayoutTrafficLightsSoon {
  __weak WingChromiumHost *weakSelf = self;
  for (NSNumber *delay in @[ @0, @0.1, @0.3 ])
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay.doubleValue * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                     [weakSelf layoutTrafficLights];
                   });
}
// The Dock icon set above lasts only while Wing runs. Finder, Launchpad and a
// quit Dock read the bundle, which every reinstall replaces, so the chosen icon
// is written onto the bundle again whenever it is missing. Violet is the default.
- (void)stampBundleIcon:(NSString *)name image:(NSImage *)image {
  NSBundle *bundle = NSBundle.mainBundle;
  if ([bundle.infoDictionary[@"WingQualificationOnly"] boolValue]) return;
  NSString *marker = [bundle.bundlePath stringByAppendingPathComponent:@"Icon\r"];
  BOOL stamped = [NSFileManager.defaultManager fileExistsAtPath:marker];
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  BOOL wanted = ![name isEqual:@"violet"];
  if (wanted ? stamped && [[defaults stringForKey:@"WingBundleIcon"] isEqual:name] : !stamped) return;
  if ([NSWorkspace.sharedWorkspace setIcon:wanted ? image : nil forFile:bundle.bundlePath options:0])
    [defaults setObject:wanted ? name : nil forKey:@"WingBundleIcon"];
}
- (void)layoutTrafficLights {
  NSWindow *window = _window.window;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSView *container = close.superview.superview;
  if (!container || (window.styleMask & NSWindowStyleMaskFullScreen))
    return;
  const CGFloat height = 52, left = 18, spacing = 20;
  NSRect frame = container.frame;
  frame.size.height = height;
  frame.origin.y = NSHeight(window.frame) - height;
  container.frame = frame;
  CGFloat x = left;
  for (NSNumber *kind in @[ @(NSWindowCloseButton), @(NSWindowMiniaturizeButton),
                            @(NSWindowZoomButton) ]) {
    NSButton *button = [window standardWindowButton:(NSWindowButton)kind.integerValue];
    NSRect bounds = button.frame;
    bounds.origin = NSMakePoint(x, round((height - NSHeight(bounds)) / 2));
    button.frame = bounds;
    x += spacing;
  }
}
- (void)engineWillShutDown {
  _quitting = YES;
  [_extensionPanel close];
  [_extensionSidebar close];
  [_maintenanceTimer invalidate];
  if (_memoryPressure) dispatch_source_cancel(_memoryPressure);
  for (WingDeviceChooser *chooser in [_deviceChoosers.allValues copy]) [chooser cancel];
  [_importProcess stop];
  [NSAppleEventManager.sharedAppleEventManager
      removeEventHandlerForEventClass:'GURL'
                           andEventID:'GURL'];
  if (_resizeObserver)
    [NSNotificationCenter.defaultCenter removeObserver:_resizeObserver];
}
- (NSString *)identityForTab:(ArdiaCoreTab *)tab {
  for (NSString *key in _tabs)
    if (_tabs[key] == tab)
      return key;
  return nil;
}
- (ArdiaCoreWindow *)engineWindowForNewBrowserOfProfile:
                         (ArdiaCoreProfile *)profile
                                                   type:(NSString *)type {
  // Popups from a private page stay in a private window, the front one first.
  if (profile.offTheRecord) {
    WingChromiumHost *front = [WingChromiumHost keyHost];
    if (front->_private && front->_profiles[@"private"] == profile) return front->_window;
    for (WingChromiumHost *host in gPrivateHosts)
      if (host->_profiles[@"private"] == profile) return host->_window;
  }
  return _window;
}
// Only the page overrides in the Develop menu may reach the protocol.
- (void)runDevCalls:(NSArray *)calls
              index:(NSUInteger)index
               page:(ArdiaCoreTab *)page
             reload:(BOOL)reload
              reply:(NSNumber *)rid {
  static NSSet *allowed;
  if (!allowed)
    allowed = [NSSet setWithArray:@[
      @"Network.enable", @"Network.setCacheDisabled", @"Network.emulateNetworkConditions",
      @"Emulation.setScriptExecutionDisabled", @"Emulation.setDeviceMetricsOverride",
      @"Emulation.clearDeviceMetricsOverride", @"Emulation.setEmulatedMedia",
      @"Emulation.setUserAgentOverride", @"Network.setBlockedURLs"
    ]];
  if (![calls isKindOfClass:NSArray.class] || index >= calls.count) {
    if (reload) [page reload];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  NSDictionary *call = calls[index];
  if (![call isKindOfClass:NSDictionary.class] || ![allowed containsObject:call[@"method"]]) {
    [self reply:rid result:nil error:@"Unknown developer override."];
    return;
  }
  [page devToolsCall:call[@"method"]
              params:call[@"params"]
             timeout:0
          completion:^(NSDictionary *result, NSString *error) {
            if (error) {
              [self reply:rid result:nil error:error];
              return;
            }
            [self runDevCalls:calls index:index + 1 page:page reload:reload reply:rid];
          }];
}
// gh and glab read pull requests with the developer's own sign-in; lsof lists
// local servers. Nothing else can be run, and only with these argument shapes.
- (void)runTool:(NSDictionary *)data reply:(NSNumber *)rid {
  NSString *tool = data[@"tool"];
  NSArray *args = data[@"args"];
  BOOL strings = [args isKindOfClass:NSArray.class];
  for (id arg in strings ? args : @[])
    if (![arg isKindOfClass:NSString.class]) strings = NO;
  BOOL valid =
      strings &&
      (([tool isEqual:@"lsof"] && [args isEqual:@[ @"-nP", @"-iTCP", @"-sTCP:LISTEN" ]]) ||
       ([tool isEqual:@"gh"] && args.count == 4 && [args[0] isEqual:@"api"] &&
        [args[1] isEqual:@"graphql"] && [args[2] isEqual:@"-f"] && [args[3] hasPrefix:@"query={"]) ||
       ([tool isEqual:@"glab"] && args.count == 2 && [args[0] isEqual:@"api"] &&
        ([args[1] isEqual:@"user"] || [args[1] hasPrefix:@"merge_requests?"])));
  if (!valid) {
    [self reply:rid result:nil error:@"That tool cannot be run."];
    return;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *path = nil;
    for (NSString *directory in @[ @"/opt/homebrew/bin", @"/usr/local/bin", @"/usr/bin", @"/usr/sbin" ]) {
      NSString *candidate = [directory stringByAppendingPathComponent:tool];
      if ([NSFileManager.defaultManager isExecutableFileAtPath:candidate]) {
        path = candidate;
        break;
      }
    }
    if (!path) {
      dispatch_async(dispatch_get_main_queue(), ^{
        [self reply:rid result:@{@"status" : @127, @"missing" : @YES, @"stdout" : @"", @"stderr" : @""} error:nil];
      });
      return;
    }
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:path];
    task.arguments = args;
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    environment[@"PATH"] = @"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin";
    task.environment = environment;
    NSPipe *output = [NSPipe pipe], *errors = [NSPipe pipe];
    task.standardOutput = output;
    task.standardError = errors;
    NSError *launch = nil;
    if (![task launchAndReturnError:&launch]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        [self reply:rid result:@{@"status" : @127, @"missing" : @YES, @"stdout" : @"", @"stderr" : @""} error:nil];
      });
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC),
                   dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
                     if (task.running) [task terminate];
                   });
    __block NSData *errorData = nil;
    dispatch_group_t group = dispatch_group_create();
    dispatch_group_async(group, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      errorData = [errors.fileHandleForReading readDataToEndOfFile];
    });
    NSData *outputData = [output.fileHandleForReading readDataToEndOfFile];
    dispatch_group_wait(group, DISPATCH_TIME_FOREVER);
    [task waitUntilExit];
    NSDictionary *result = @{
      @"status" : @(task.terminationStatus),
      @"stdout" : [[NSString alloc] initWithData:outputData encoding:NSUTF8StringEncoding] ?: @"",
      @"stderr" : [[NSString alloc] initWithData:errorData encoding:NSUTF8StringEncoding] ?: @""
    };
    dispatch_async(dispatch_get_main_queue(), ^{
      [self reply:rid result:result error:nil];
    });
  });
}
- (void)openMini:(NSDictionary *)data reply:(NSNumber *)rid {
  NSArray *spaces = data[@"spaces"];
  NSString *spaceId = data[@"spaceId"], *url = data[@"url"], *search = data[@"search"];
  if (![spaces isKindOfClass:NSArray.class] || !spaces.count || ![spaceId isKindOfClass:NSString.class] ||
      ![search isKindOfClass:NSString.class] || ![search hasPrefix:@"https://"] ||
      ([url length] && !WebURL(url))) {
    [self reply:rid result:nil error:@"Invalid mini window."];
    return;
  }
  __weak __typeof(self) weak = self;
  [WingMiniWindow
      openURL:[url length] ? url : nil
       spaces:spaces
      spaceId:spaceId
       search:search
       loader:^(NSString *profileId, void (^ready)(ArdiaCoreProfile *)) {
         __typeof(self) strong = weak;
         if (!strong || !Identifier(profileId)) return ready(nil);
         if (strong->_profiles[profileId]) return ready(strong->_profiles[profileId]);
         [ArdiaCoreEngine.sharedEngine
             loadProfile:[@"Wing-" stringByAppendingString:profileId]
              completion:^(ArdiaCoreProfile *profile) {
                if (profile) strong->_profiles[profileId] = profile;
                ready(profile);
              }];
       }
       expand:^(NSString *target, NSString *space) {
         [self showMainWindow:nil];
         [self send:@"action"
               data:@{@"name" : @"mini-expand", @"args" : @{@"url" : target, @"spaceId" : space}}];
       }
        visit:^(NSString *target, NSString *title, NSString *space) {
          [self send:@"action"
                data:@{
                  @"name" : @"mini-visit",
                  @"args" : @{@"url" : target, @"title" : title, @"spaceId" : space}
                }];
        }];
  [self reply:rid result:@{@"ok" : @YES, @"open" : @(WingMiniWindow.openCount)} error:nil];
}
- (void)newPrivateWindow:(id)sender {
  WingChromiumHost *main = gMainHost;
  // Private windows share one off-the-record profile while any is open.
  WingChromiumHost *first = gPrivateHosts.firstObject;
  ArdiaCoreProfile *existing = first ? first->_profiles[@"private"] : nil;
  NSMutableDictionary *settings =
      [main->_lastSync[@"workspace"][@"settings"] mutableCopy] ?: [NSMutableDictionary new];
  void (^open)(ArdiaCoreProfile *) = ^(ArdiaCoreProfile *profile) {
    gPrivateHosts = gPrivateHosts ?: [NSMutableArray new];
    [gPrivateHosts addObject:[[WingChromiumHost alloc] initPrivateWithProfile:profile
                                                                     settings:settings]];
  };
  if (existing && !existing.destroyed) {
    open(existing);
    return;
  }
  ArdiaCoreProfile *base = main->_window.activeProfile ?: main->_profiles[@"default"];
  if (!base) {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"A private window couldn’t be opened.";
    alert.informativeText = @"Open a page in Wing first, then try again.";
    [alert runModal];
    return;
  }
  [ArdiaCoreEngine.sharedEngine
      offTheRecordProfileFor:base
                  completion:^(ArdiaCoreProfile *offTheRecord, NSString *error) {
                    if (!offTheRecord) {
                      NSAlert *alert = [NSAlert new];
                      alert.messageText = @"A private window couldn’t be opened.";
                      alert.informativeText = error ?: @"";
                      [alert runModal];
                      return;
                    }
                    open(offTheRecord);
                  }];
}
- (void)window:(ArdiaCoreWindow *)window
    didInsertTab:(ArdiaCoreTab *)tab
          opener:(ArdiaCoreTab *)opener
     disposition:(NSString *)disposition {
  // Owned opens are registered by their caller before this deferred check.
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_quitting || tab.closed || tab == self->_shell ||
        [self identityForTab:tab] ||
        [self->_protectionTabs.allValues containsObject:tab] ||
        [self->_serviceTabs.allValues containsObject:tab] ||
        [self->_extensionManagers.allValues containsObject:tab])
      return;
    NSString *profileId;
    for (NSString *candidate in self->_profiles)
      if (self->_profiles[candidate] == tab.profile) {
        profileId = candidate;
        break;
      }
    if (!profileId)
      return;
    NSString *identity = NSUUID.UUID.UUIDString;
    self->_tabs[identity] = tab;
    [tab executeJavaScript:kTrackEditsScript frame:nil];
    [self->_pendingCreatedTabs addObject:identity];
    self->_modelURLs[identity] = tab.url.length ? tab.url : @"about:blank";
    tab.delegate = self;
    [self send:@"created"
          data:@{
            @"id" : identity,
            @"profileId" : profileId,
            @"url" : tab.url ?: @"about:blank",
            @"foreground" : @(![disposition isEqual:@"background_tab"]),
            // Shift-click asks for a new window; Wing shows it as a Peek.
            @"peek" : @([disposition isEqual:@"window"])
          }];
    [self pageChanged:tab];
  });
}
- (void)tab:(ArdiaCoreTab *)tab requestsActivation:(NSString *)reason {
  NSString *identity = [self identityForTab:tab];
  if (identity)
    [self send:@"action"
          data:@{@"name" : @"select-tab", @"args" : @{@"id" : identity}}];
}
- (void)applyStyle:(ArdiaCoreTab *)tab {
  NSString *identity = [self identityForTab:tab];
  if (!identity || !tab.committedOrigin)
    return;
  NSString *css =
      _lastSync[@"workspace"][@"boosts"][tab.committedOrigin] ?: @"";
  if ([_appliedStyles[identity] isEqual:css])
    return;
  _appliedStyles[identity] = css;
  [tab executeJavaScript:
           [NSString
               stringWithFormat:
                   @"(()=>{const apply=()=>{let "
                   @"style=document.getElementById('wing-site-style');if(!"
                   @"style){style=document.createElement('style');style.id='"
                   @"wing-site-style';(document.head||document.documentElement)"
                   @".append(style);}style.textContent=%@;};if(document."
                   @"documentElement)apply();"
                   @"else "
                   @"document.addEventListener('DOMContentLoaded',apply,{once:"
                   @"true});})()",
                   JSON(css)]
                  frame:nil];
}
- (void)tabDidCommitDocument:(ArdiaCoreTab *)tab {
  [self cancelExternalRequestsForTab:tab];
  [self cancelDeviceRequestsForTab:tab];
  NSString *identity = [self identityForTab:tab];
  if (identity)
    [_crashedTabs removeObjectForKey:identity];
  if (identity)
    [_wakingTabs removeObject:identity];
  if (identity)
    [_appliedStyles removeObjectForKey:identity];
  if (identity)
    [tab executeJavaScript:kTrackEditsScript frame:nil];
  [self applyStyle:tab];
  [self pageChanged:tab];
  if ([_protectionTabs.allValues containsObject:tab])
    [self tabDidChangeLoading:tab];
}
- (void)pageChanged:(ArdiaCoreTab *)tab {
  NSString *identity = [self identityForTab:tab];
  if (!identity || tab.closed || _quitting)
    return;
  [self send:@"page"
        data:@{
          @"id" : identity,
          @"url" : tab.url ?: @"",
          @"title" : tab.title ?: @"",
          // A paused or sleeping page can't finish loading until it wakes.
          @"loading" : @(tab.loading && !tab.frozen && !tab.discarded),
          @"canGoBack" : @(tab.canGoBack),
          @"canGoForward" : @(tab.canGoForward),
          @"audible" : @(tab.audible),
          @"muted" : @(tab.muted),
          @"capturing" : @([_capturingTabs containsObject:identity]),
          @"screenSharing" : @([_screenSharingTabs containsObject:identity]),
          @"pictureInPicture" : @([_pictureInPictureTabs containsObject:identity]),
          @"favicon" : tab.faviconURL ?: @"",
          @"progress" : @(tab.progress),
          @"zoom" : @(tab.zoomFactor),
          @"crashed" : _crashedTabs[identity] ?: @""
        }];
}
- (void)tab:(ArdiaCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  NSString *identity = [self identityForTab:tab];
  if (!identity || tab.closed || _quitting || [status isEqual:@"normal"])
    return;
  [_hangPrompts[identity] dismiss];
  [_hangPrompts removeObjectForKey:identity];
  _crashedTabs[identity] = status;
  [self pageChanged:tab];
}
- (void)tabBecameUnresponsive:(ArdiaCoreTab *)tab {
  NSString *identity = [self identityForTab:tab];
  if (!identity || _hangPrompts[identity] || tab.closed)
    return;
  // Background tabs wait; the prompt appears only for the page in front.
  if (![_lastSync[@"workspace"][@"activeTabId"] isEqual:identity]) {
    [tab resolveUnresponsive:NO];
    return;
  }
  __weak ArdiaCoreTab *weakTab = tab;
  _hangPrompts[identity] = [WingPromptPopover
      showInView:_window.hostView
          anchor:[self promptAnchor]
          symbol:@"hourglass"
           title:[NSString stringWithFormat:@"“%@” isn’t responding", SiteName(tab.url)]
         message:@"You can wait for it, or exit the page and reload it later."
         buttons:@[ @"Exit Page", @"Wait" ]
        remember:nil
      completion:^(NSInteger choice, BOOL remember) {
        [self->_hangPrompts removeObjectForKey:identity];
        [weakTab resolveUnresponsive:choice == 0];
      }];
}
- (void)tabBecameResponsive:(ArdiaCoreTab *)tab {
  NSString *identity = [self identityForTab:tab];
  if (!identity) return;
  WingPromptPopover *prompt = _hangPrompts[identity];
  [_hangPrompts removeObjectForKey:identity];
  [prompt dismiss];
}
- (void)tab:(ArdiaCoreTab *)tab navigationBecameDownload:(NSString *)url {
  // The services page may not be loaded yet; ask the shell to refresh its
  // library so the downloads button appears and starts tracking progress.
  for (NSString *profileId in _profiles)
    if (_profiles[profileId] == tab.profile) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC),
                     dispatch_get_main_queue(), ^{
                       [self send:@"service-event" data:@{@"profileId" : profileId}];
                     });
      return;
    }
}
- (void)tabDidChangeProgress:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tabDidChangeZoom:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tab:(ArdiaCoreTab *)tab
    didFindMatches:(int)count
            active:(int)active
             final:(BOOL)final {
  NSString *identity = [self identityForTab:tab];
  if (!identity)
    return;
  [self send:@"command"
        data:@{
          @"type" : @"find-result",
          @"id" : identity,
          @"count" : @(count),
          @"active" : @(active),
          @"final" : @(final)
        }];
}
- (void)tab:(ArdiaCoreTab *)tab didChangePictureInPicture:(NSDictionary *)state {
  NSString *identity = [self identityForTab:tab];
  if (!identity) return;
  if ([state[@"active"] boolValue]) [_pictureInPictureTabs addObject:identity];
  else {
    [_pictureInPictureTabs removeObject:identity];
    [_miniPlayerTabs removeObject:identity];
  }
  [self pageChanged:tab];
}
- (void)tab:(ArdiaCoreTab *)tab
    didChangeMediaAccess:(NSDictionary<NSString *, NSNumber *> *)access {
  NSString *identity = [self identityForTab:tab];
  if (!identity)
    return;
  if ([access[@"screen"] boolValue]) [_screenSharingTabs addObject:identity];
  else [_screenSharingTabs removeObject:identity];
  if ([access[@"camera"] boolValue] || [access[@"microphone"] boolValue] ||
      [access[@"screen"] boolValue])
    [_capturingTabs addObject:identity];
  else
    [_capturingTabs removeObject:identity];
  [self pageChanged:tab];
}
- (void)window:(ArdiaCoreWindow *)window
    devToolsDidChangeForTab:(ArdiaCoreTab *)tab
                       view:(NSView *)view {
  [self applyLayout];
}
- (void)window:(ArdiaCoreWindow *)window
                    tab:(ArdiaCoreTab *)tab
    didChangeFullscreen:(BOOL)fullscreen {
  if (window != _window || _quitting)
    return;
  NSWindow *native = _window.window;
  BOOL windowFull = (native.styleMask & NSWindowStyleMaskFullScreen) != 0;
  if (fullscreen) {
    _fullscreenTab = tab;
    if (!windowFull) {
      _fullscreenTookWindow = YES;
      [native toggleFullScreen:nil];
    }
  } else if (tab == _fullscreenTab) {
    _fullscreenTab = nil;
    if (_fullscreenTookWindow && windowFull)
      [native toggleFullScreen:nil];
    _fullscreenTookWindow = NO;
  }
  [self applyLayout];
}
- (void)windowWillLeaveFullScreen {
  // Leaving the Mac's full screen (green button, ⌃⌘F) ends the video's too.
  _fullscreenTookWindow = NO;
  ArdiaCoreTab *tab = _fullscreenTab;
  _fullscreenTab = nil;
  if (tab && !tab.closed)
    [tab exitFullscreen];
  [self applyLayout];
}
- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
  if (!tab.loading && !tab.closed) {
    for (NSString *identity in _protectionTabs.allKeys) {
      if (_protectionTabs[identity] == tab &&
          ![tab.url isEqual:_protectionURLs[identity]] &&
          [self->_protectionDeadlines[identity] timeIntervalSinceNow] > 0) {
        // During profile startup Chromium loads its component registry again.
        // It replaces an open extension document with New Tab. Only this owned
        // initialization page is reopened; ordinary browsing stays paused.
        [_checkingProtection removeObject:identity];
        [tab loadURL:_protectionURLs[identity] userInitiated:NO];
        return;
      }
    }
  }
  if ([tab.committedOrigin hasPrefix:@"chrome-extension://"] &&
      [tab.url hasSuffix:@"/dashboard.html"]) {
    for (NSString *identity in _protectionTabs.allKeys) {
      if (_protectionTabs[identity] != tab ||
          [_checkingProtection containsObject:identity])
        continue;
      [_checkingProtection addObject:identity];
      // getLists is explicitly gated by uBO's isReadyPromise. Do not load the
      // first browsing page until the real filtering engines have initialized.
      NSString *probe = [NSString
          stringWithContentsOfFile:
              [NSBundle.mainBundle.resourcePath
                  stringByAppendingPathComponent:@"protection-ready.js"]
                          encoding:NSUTF8StringEncoding
                             error:nil];
      [tab evaluate:probe
          completion:^(NSString *result) {
            if (self->_protectionTabs[identity] != tab ||
                [self->_protectedProfiles containsObject:identity])
              return;
            if (!result && !tab.closed && !self->_quitting &&
                [self->_protectionDeadlines[identity] timeIntervalSinceNow] >
                    0) {
              // A first-run extension reload can replace the document while a
              // readiness RPC is pending. Retry in the new committed context.
              [self->_checkingProtection removeObject:identity];
              dispatch_after(
                  dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                  dispatch_get_main_queue(), ^{
                    [self tabDidChangeLoading:tab];
                  });
              return;
            }
            id value = result ? Parse(result) : nil;
            if ([value isKindOfClass:NSString.class])
              value = Parse(value);
            if ([value isKindOfClass:NSDictionary.class] &&
                [value[@"ready"] boolValue]) {
              [self->_protectedProfiles addObject:identity];
              [self->_protectionTabs removeObjectForKey:identity];
              tab.delegate = nil;
              [tab closeNow];
              [self applyLayout];
            } else {
              if (!tab.closed && !self->_quitting &&
                  [self->_protectionDeadlines[identity] timeIntervalSinceNow] >
                      0) {
                [self->_checkingProtection removeObject:identity];
                [self->_profiles[identity]
                    loadComponentExtension:[NSBundle.mainBundle.resourcePath
                                               stringByAppendingPathComponent:
                                                   kProtectionFolder]];
                [tab loadURL:self->_protectionURLs[identity] userInitiated:NO];
                return;
              }
              if (getenv("WING_CHROMIUM_TEST_SCRIPT"))
                fprintf(stderr, "uBlock initialization result: %s\n",
                        result.UTF8String ?: "(missing)");
              [self send:@"command"
                    data:@{
                      @"type" : @"toast",
                      @"message" : @"uBlock could not initialize. Browsing "
                                   @"remains paused for this profile."
                    }];
            }
          }];
    }
  }
  const char *scriptPath = getenv("WING_CHROMIUM_TEST_SCRIPT");
  if (tab == _shell && !_private && !tab.loading && !_qualificationStarted && scriptPath) {
    _qualificationStarted = YES;
    NSString *script = [NSString stringWithContentsOfFile:@(scriptPath)
                                                 encoding:NSUTF8StringEncoding
                                                    error:nil];
    [_shell evaluate:script
          completion:^(NSString *result) {
            const char *output = getenv("WING_CHROMIUM_TEST_REPORT");
            if (output && result)
              [result writeToFile:@(output)
                       atomically:YES
                         encoding:NSUTF8StringEncoding
                            error:nil];
            [self quit:nil];
          }];
  }
}
- (void)tabDidChangeNavigationState:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tabDidChangeFavicon:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tabDidChangeAudio:(ArdiaCoreTab *)tab {
  [self pageChanged:tab];
}
- (void)tabWillClose:(ArdiaCoreTab *)tab {
  [self cancelExternalRequestsForTab:tab];
  [self cancelDeviceRequestsForTab:tab];
  NSString *identity = [self identityForTab:tab];
  if (!identity)
    return;
  [self closeExtensionViewsForTabID:identity];
  NSNumber *archive = _closing[identity] ?: @NO;
  [_tabs removeObjectForKey:identity];
  [_restorableTabs addObject:identity];
  [_crashedTabs removeObjectForKey:identity];
  [_hangPrompts[identity] dismiss];
  [_hangPrompts removeObjectForKey:identity];
  [_modelURLs removeObjectForKey:identity];
  [_closing removeObjectForKey:identity];
  [_wakingTabs removeObject:identity];
  [_capturingTabs removeObject:identity];
  [_pendingCreatedTabs removeObject:identity];
  [_pictureInPictureTabs removeObject:identity];
  [_screenSharingTabs removeObject:identity];
  if (!_quitting)
    [self send:@"closed" data:@{@"id" : identity, @"archive" : archive}];
}
- (void)window:(ArdiaCoreWindow *)window didRemoveTab:(ArdiaCoreTab *)tab {
  // Component registry startup can destroy the readiness document outright.
  // Recreate only our private probe, within the original bounded deadline.
  for (NSString *profileId in _protectionTabs.allKeys) {
    if (_protectionTabs[profileId] != tab || _quitting ||
        [_protectionDeadlines[profileId] timeIntervalSinceNow] <= 0)
      continue;
    [_checkingProtection removeObject:profileId];
    [_profiles[profileId]
        loadComponentExtension:
            [NSBundle.mainBundle.resourcePath
                stringByAppendingPathComponent:kProtectionFolder]];
    ArdiaCoreTab *probe = [_window openTab:_protectionURLs[profileId]
                                   profile:_profiles[profileId]
                                foreground:NO];
    _protectionTabs[profileId] = probe;
    probe.delegate = self;
    return;
  }
  // The core intentionally suppresses tabWillClose for host-initiated closes.
  // Removal confirms that beforeunload permitted the close; never mutate the
  // saved workspace merely because a close was requested.
  NSString *identity = [self identityForTab:tab];
  if (identity && _closing[identity])
    [self tabWillClose:tab];
}
- (void)orderShell {
  NSView *host = _window.hostView, *shell = _shell.view;
  NSArray *order = host.subviews;
  NSMutableArray *pages = [order mutableCopy];
  [pages removeObject:shell];
  NSInteger position = 0;
  for (NSView *view in pages) {
    if ([view isKindOfClass:NSVisualEffectView.class]) position++;
    else break;
  }
  [pages insertObject:shell atIndex:_shellRaised ? pages.count : position];
  if ([pages isEqualToArray:order]) return;
  // Sorting keeps every view attached, so pages don't reload or lose their state.
  NSMapTable *ranks = [NSMapTable strongToStrongObjectsMapTable];
  [pages enumerateObjectsUsingBlock:^(NSView *view, NSUInteger index, BOOL *stop) {
    [ranks setObject:@(index) forKey:view];
  }];
  [host sortSubviewsUsingFunction:CompareSubviewRank context:(__bridge void *)ranks];
}
- (void)applyLayout {
  if (_quitting || !_lastSync)
    return;
  NSDictionary *state = _lastSync[@"workspace"];
  if (_extensionSidebarOwner && ![_extensionSidebarOwner isEqual:state[@"activeTabId"]]) {
    [_extensionSidebar close];
    _extensionSidebarOwner = nil;
  }
  if (_extensionPanelOwner &&
      ![_extensionPanelOwner isEqual:state[@"activeTabId"]]) {
    [_extensionPanel close];
    _extensionPanelOwner = nil;
  }
  for (NSString *identity in _tabs.allKeys) {
    NSDictionary *record;
    for (NSDictionary *candidate in state[@"tabs"])
      if ([candidate[@"id"] isEqual:identity]) {
        record = candidate;
        break;
      }
    NSString *profileId;
    for (NSDictionary *space in state[@"spaces"])
      if ([space[@"id"] isEqual:record[@"spaceId"]]) {
        profileId = space[@"profileId"];
        break;
      }
    ArdiaCoreTab *page = _tabs[identity];
    if (record)
      [_pendingCreatedTabs removeObject:identity];
    else if ([_pendingCreatedTabs containsObject:identity])
      continue;
    // Off-the-record profiles have no stable name, so private pages match by profile.
    BOOL ownProfile = _private ? page.profile == _profiles[profileId ?: @""]
                               : [page.profile.name
                                     isEqual:[@"Wing-" stringByAppendingString:profileId ?: @""]];
    if (!record || [record[@"closed"] boolValue] || !ownProfile) {
      [self closeExtensionViewsForTabID:identity];
      [_tabs removeObjectForKey:identity];
      [_crashedTabs removeObjectForKey:identity];
      [_hangPrompts[identity] dismiss];
      [_hangPrompts removeObjectForKey:identity];
      [_modelURLs removeObjectForKey:identity];
      [_appliedStyles removeObjectForKey:identity];
      [_wakingTabs removeObject:identity];
      [_capturingTabs removeObject:identity];
      [_pictureInPictureTabs removeObject:identity];
      [_screenSharingTabs removeObject:identity];
      page.delegate = nil;
      [page closeNow];
    } else
      [self applyStyle:page];
  }
  NSMutableSet *visible = [NSMutableSet new];
  for (NSDictionary *pane in _lastSync[@"panes"])
    if (Identifier(pane[@"id"]))
      [visible addObject:pane[@"id"]];
  NSView *departing;
  for (NSString *identity in _tabs) {
    ArdiaCoreTab *page = _tabs[identity];
    if (![visible containsObject:identity]) {
      if (page.view.superview == _window.hostView && !page.view.hidden && !_departures[identity])
        [self openMiniPlayer:page identity:identity];
      // The page being left fades out over the incoming one, so a switch never
      // flashes an empty frame while the new page paints.
      if (!_departures[identity] && visible.count && page.view.superview == _window.hostView &&
          !page.view.hidden && _window.window.isVisible) {
        NSNumber *generation = @(arc4random());
        _departures[identity] = generation;
        [page.devToolsView removeFromSuperview];
        [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
          context.duration = 0.18;
          page.view.animator.alphaValue = 0;
        } completionHandler:^{ [self finishDeparture:identity generation:generation]; }];
      }
      if (_departures[identity]) {
        departing = page.view;
        continue;
      }
      if (page.view.superview) [self scheduleFreeze:identity];
      [page noteShownByHost:NO];
      [page.view removeFromSuperview];
      [page.devToolsView removeFromSuperview];
    } else {
      if (_departures[identity]) {
        [_departures removeObjectForKey:identity];
        page.view.alphaValue = 1;
      }
      [self thaw:page];
      [self closeMiniPlayer:identity];
    }
  }
  for (NSString *identity in _webkitPages.allKeys) {
    NSDictionary *record;
    for (NSDictionary *candidate in state[@"tabs"])
      if ([candidate[@"id"] isEqual:identity]) {
        record = candidate;
        break;
      }
    WingWebKitPage *webkit = _webkitPages[identity];
    if (!record || [record[@"closed"] boolValue]) {
      [webkit close];
      [_webkitPages removeObjectForKey:identity];
      [_modelURLs removeObjectForKey:identity];
    } else if (![visible containsObject:identity])
      [webkit.view removeFromSuperview];
  }
  CGFloat contentLeft = _window.hostView.bounds.size.width;
  for (NSDictionary *pane in _lastSync[@"panes"])
    contentLeft = MIN(contentLeft, [pane[@"x"] doubleValue]);
  CGFloat available = MAX(0, _window.hostView.bounds.size.width - contentLeft);
  CGFloat sidebarWidth = _extensionSidebar.page && available > 400 ? MIN(360, available * 0.45) : 0;
  for (NSDictionary *pane in _lastSync[@"panes"]) {
    NSString *identity = pane[@"id"];
    NSDictionary *record;
    for (NSDictionary *candidate in state[@"tabs"])
      if ([candidate[@"id"] isEqual:identity]) {
        record = candidate;
        break;
      }
    if (!record || !WebURL(record[@"url"]))
      continue;
    NSString *profileId;
    for (NSDictionary *space in state[@"spaces"])
      if ([space[@"id"] isEqual:record[@"spaceId"]]) {
        profileId = space[@"profileId"];
        break;
      }
    if (!Identifier(profileId))
      continue;
    if (_webkitPages[identity] || WingStreamingURL(record[@"url"])) {
      CGFloat x = [pane[@"x"] doubleValue], y = [pane[@"y"] doubleValue],
              w = [pane[@"width"] doubleValue], h = [pane[@"height"] doubleValue];
      if (sidebarWidth > 0) {
        CGFloat scale = (available - sidebarWidth - 8) / available;
        x = contentLeft + (x - contentLeft) * scale;
        w *= scale;
      }
      [self showWebKitPage:identity record:record profileId:profileId
                     frame:NSMakeRect(x, _window.hostView.isFlipped ? y : _window.hostView.bounds.size.height - y - h,
                                      MAX(1, w), MAX(1, h))
                    active:[identity isEqual:state[@"activeTabId"]]];
      continue;
    }
    ArdiaCoreProfile *profile = _profiles[profileId];
    if (!profile && _private) continue;
    if (!profile) {
      if (![_loadingProfiles containsObject:profileId]) {
        [_loadingProfiles addObject:profileId];
        [ArdiaCoreEngine.sharedEngine
            loadProfile:[@"Wing-" stringByAppendingString:profileId]
             completion:^(ArdiaCoreProfile *loaded) {
               [self->_loadingProfiles removeObject:profileId];
               if (loaded) {
                 self->_profiles[profileId] = loaded;
                 [self applyLayout];
               } else
                 [self
                     send:@"command"
                     data:@{
                       @"type" : @"toast",
                       @"message" : @"The browser profile could not be opened."
                     }];
             }];
      }
      continue;
    }
    if (![_protectedProfiles containsObject:profileId]) {
      if (![_startingProtection containsObject:profileId]) {
        [_startingProtection addObject:profileId];
        [_window prepareProfile:profile];
        NSString *path = [NSBundle.mainBundle.resourcePath
            stringByAppendingPathComponent:kProtectionFolder];
        NSDictionary *manifest = Parse([NSString
            stringWithContentsOfFile:
                [path stringByAppendingPathComponent:@"manifest.json"]
                            encoding:NSUTF8StringEncoding
                               error:nil]);
        // Missing component keys trigger a fatal Chromium CHECK; validate
        // before entering the engine, even though the bundle is signed at build
        // time.
        if (![manifest[@"key"] isKindOfClass:NSString.class] ||
            ![manifest[@"key"] length]) {
          [self send:@"command"
                data:@{
                  @"type" : @"toast",
                  @"message" : @"The bundled protection extension is invalid."
                }];
          continue;
        }
        [profile loadComponentExtension:
                     [NSBundle.mainBundle.resourcePath
                         stringByAppendingPathComponent:@"WingServices"]];
        NSString *extensionId = [profile loadComponentExtension:path];
        if (!extensionId)
          continue;
        // Pages wait (up to 10 s, in the engine) until the blocking rules are
        // in force, so the first page is filtered without a startup document.
        [profile holdNavigationsUntilRulesetsOf:extensionId];
        [profile watchCastRoutes];
        _protectionURLs[profileId] =
            [NSString stringWithFormat:@"chrome-extension://%@/dashboard.html", extensionId];
        [_protectedProfiles addObject:profileId];
      }
      if (![_protectedProfiles containsObject:profileId])
        continue;
    }
    ArdiaCoreTab *tab = _tabs[identity];
    if (!tab && [_restoringTabs containsObject:identity])
      continue;
    if (!tab && [_restorableTabs containsObject:identity]) {
      [self restorePage:identity url:record[@"url"] profile:profile];
      continue;
    }
    if (!tab) {
      tab = [_window openTab:record[@"url"] profile:profile foreground:NO];
      [self adoptPage:tab identity:identity url:record[@"url"]];
    } else if (tab.profile != profile) {
      // Never silently move a live document across a profile boundary.
      [self send:@"command"
            data:@{
              @"type" : @"toast",
              @"message" : @"Cross-profile moves are not yet migrated."
            }];
      continue;
    } else if (![_modelURLs[identity] isEqual:record[@"url"]]) {
      // A sync can lag native navigation events. Only a changed model URL is
      // a navigation request; an unchanged stale snapshot must not navigate
      // back.
      _modelURLs[identity] = record[@"url"];
      if (![tab.url isEqual:record[@"url"]])
        [tab loadURL:record[@"url"] userInitiated:YES];
    }
    if (tab.discarded && ![_wakingTabs containsObject:identity]) {
      [_wakingTabs addObject:identity];
      [tab reload];
    }
    if (tab.view.superview != _window.hostView)
      [_window.hostView addSubview:tab.view
                        positioned:departing ? NSWindowBelow : NSWindowAbove
                        relativeTo:departing];
    CGFloat height = _window.hostView.bounds.size.height;
    CGFloat x = [pane[@"x"] doubleValue], y = [pane[@"y"] doubleValue],
            w = [pane[@"width"] doubleValue], h = [pane[@"height"] doubleValue];
    if (sidebarWidth > 0) {
      CGFloat scale = (available - sidebarWidth - 8) / available;
      x = contentLeft + (x - contentLeft) * scale;
      w *= scale;
    }
    NSRect pageFrame = NSMakeRect(0, 0, MAX(1, w), MAX(1, h)), toolsFrame;
    NSView *toolsView = tab.devToolsView;
    if (toolsView) {
      [tab devToolsLayoutForSize:pageFrame.size
                        devTools:&toolsFrame
                            page:&pageFrame];
      if (toolsView.superview != _window.hostView)
        [_window.hostView addSubview:toolsView];
      toolsView.frame = NSMakeRect(
          x + toolsFrame.origin.x,
          _window.hostView.isFlipped
              ? y + toolsFrame.origin.y
              : height - y - toolsFrame.origin.y - toolsFrame.size.height,
          toolsFrame.size.width, toolsFrame.size.height);
    }
    tab.view.frame = NSMakeRect(x + pageFrame.origin.x,
                                _window.hostView.isFlipped
                                    ? y + pageFrame.origin.y
                                    : height - y - pageFrame.origin.y -
                                          pageFrame.size.height,
                                pageFrame.size.width, pageFrame.size.height);
    // Pages sit in a rounded card like Arc's, matching the shell's radius.
    tab.view.wantsLayer = YES;
    tab.view.layer.cornerRadius = 10;
    tab.view.layer.cornerCurve = @"continuous"; // kCACornerCurveContinuous without linking QuartzCore
    tab.view.layer.masksToBounds = YES;
    [tab noteShownByHost:YES];
    if ([identity isEqual:state[@"activeTabId"]]) {
      _window.activeProfile = profile;
      [_window activateTab:tab];
    }
  }
  CGFloat sidebarTop = [state[@"settings"][@"toolbarHidden"] boolValue] ? 8 : 52;
  CGFloat sidebarHeight = MAX(1, _window.hostView.bounds.size.height - sidebarTop - 8);
  [_extensionSidebar layoutIn:_window.hostView
                         frame:NSMakeRect(_window.hostView.bounds.size.width - sidebarWidth - 8,
                             _window.hostView.isFlipped ? sidebarTop : 8,
                             sidebarWidth, sidebarHeight)
                       visible:sidebarWidth > 0];
  // Chromium's tab strip hides inactive native views. Wing owns visibility
  // for every split pane, so restore it after the active-tab transition.
  for (NSString *identity in visible) {
    ArdiaCoreTab *page = _tabs[identity];
    if (page.view.superview == _window.hostView)
      page.view.hidden = NO;
    if (page.devToolsView.superview == _window.hostView)
      page.devToolsView.hidden = NO;
  }
  for (NSString *identity in _departures)
    _tabs[identity].view.hidden = NO;
  ArdiaCoreTab *full = _fullscreenTab;
  if (full && (full.closed || full.view.superview != _window.hostView)) {
    // The fullscreen page left the screen (tab switch, close): end it.
    _fullscreenTab = nil;
    if (!full.closed)
      [full exitFullscreen];
    if (_fullscreenTookWindow && (_window.window.styleMask & NSWindowStyleMaskFullScreen))
      [_window.window toggleFullScreen:nil];
    _fullscreenTookWindow = NO;
  } else if (full) {
    [full.devToolsView setHidden:YES];
    if (_window.hostView.subviews.lastObject != full.view)
      [_window.hostView addSubview:full.view positioned:NSWindowAbove relativeTo:nil];
    full.view.frame = _window.hostView.bounds;
    full.view.layer.cornerRadius = 0;
    full.view.hidden = NO;
  }
}
- (void)showWebKitPage:(NSString *)identity
                record:(NSDictionary *)record
             profileId:(NSString *)profileId
                 frame:(NSRect)frame
                active:(BOOL)active {
  WingWebKitPage *webkit = _webkitPages[identity];
  if (!webkit) {
    // A Chromium page that reached a streaming site moves over to WebKit.
    ArdiaCoreTab *page = _tabs[identity];
    if (page) {
      [self closeExtensionViewsForTabID:identity];
      [_tabs removeObjectForKey:identity];
      [_crashedTabs removeObjectForKey:identity];
      [_hangPrompts[identity] dismiss];
      [_hangPrompts removeObjectForKey:identity];
      [_appliedStyles removeObjectForKey:identity];
      [_wakingTabs removeObject:identity];
      [_capturingTabs removeObject:identity];
      [_pictureInPictureTabs removeObject:identity];
      [_screenSharingTabs removeObject:identity];
      [_departures removeObjectForKey:identity];
      if (page == _fullscreenTab)
        _fullscreenTab = nil;
      page.delegate = nil;
      [page.view removeFromSuperview];
      [page.devToolsView removeFromSuperview];
      [page closeNow];
    }
    webkit = [[WingWebKitPage alloc] initWithProfile:profileId ephemeral:_private];
    __weak WingChromiumHost *weakSelf = self;
    __weak WingWebKitPage *weakPage = webkit;
    webkit.onChange = ^{
      [weakSelf webKitPageChanged:weakPage identity:identity];
    };
    webkit.onOpen = ^(NSString *url) {
      [weakSelf send:@"action" data:@{@"name" : @"new-tab", @"args" : @{@"url" : url}}];
    };
    _webkitPages[identity] = webkit;
    _modelURLs[identity] = record[@"url"];
    [webkit load:record[@"url"]];
  } else if (![_modelURLs[identity] isEqual:record[@"url"]]) {
    _modelURLs[identity] = record[@"url"];
    if (![webkit.url isEqual:record[@"url"]])
      [webkit load:record[@"url"]];
  }
  if (webkit.view.superview != _window.hostView)
    [_window.hostView addSubview:webkit.view];
  webkit.view.frame = frame;
  webkit.view.wantsLayer = YES;
  webkit.view.layer.cornerRadius = 10;
  webkit.view.layer.cornerCurve = @"continuous";
  webkit.view.layer.masksToBounds = YES;
  if (active && _window.window.firstResponder == _window.window)
    [webkit focus];
}
- (void)webKitPageChanged:(WingWebKitPage *)webkit identity:(NSString *)identity {
  if (!webkit || _webkitPages[identity] != webkit || _quitting)
    return;
  [self send:@"page"
        data:@{
          @"id" : identity,
          @"url" : webkit.url,
          @"title" : webkit.title,
          @"loading" : @(webkit.loading),
          @"canGoBack" : @(webkit.canGoBack),
          @"canGoForward" : @(webkit.canGoForward),
          @"audible" : @NO,
          @"muted" : @NO,
          @"capturing" : @NO,
          @"screenSharing" : @NO,
          @"pictureInPicture" : @NO,
          @"favicon" : webkit.faviconURL,
          @"progress" : @(webkit.progress),
          @"zoom" : @1,
          @"crashed" : @""
        }];
}
// The mini player: a video playing with sound floats into picture in picture
// when its tab leaves the screen or Wing goes to the background.
- (void)openMiniPlayer:(ArdiaCoreTab *)page identity:(NSString *)identity {
  if (!_automaticPictureInPicture || _quitting || page.closed || page.discarded || page.frozen ||
      [_pictureInPictureTabs containsObject:identity])
    return;
  NSTimeInterval asked = NSProcessInfo.processInfo.systemUptime;
  [page evaluate:@"post('result',JSON.stringify([...document.querySelectorAll('video')].some(v=>"
                 @"!v.paused&&!v.ended&&v.readyState>2&&v.videoWidth>0&&!v.muted&&v.volume>0)))"
      completion:^(NSString *json) {
        if (![json isEqual:@"true"] || page.closed || self->_quitting)
          return;
        [page enterPictureInPictureForClickAt:asked
                                   completion:^(NSString *route, BOOL opened) {
                                     if (opened) [self->_miniPlayerTabs addObject:identity];
                                   }];
      }];
}
- (void)closeMiniPlayer:(NSString *)identity {
  if (![_miniPlayerTabs containsObject:identity])
    return;
  [_miniPlayerTabs removeObject:identity];
  if ([_pictureInPictureTabs containsObject:identity])
    [_tabs[identity] exitPictureInPicture];
}
- (void)applicationActiveChanged:(BOOL)active {
  for (NSDictionary *pane in _lastSync[@"panes"]) {
    NSString *identity = pane[@"id"];
    ArdiaCoreTab *page = Identifier(identity) ? _tabs[identity] : nil;
    if (!page || page.view.superview != _window.hostView || page.view.hidden)
      continue;
    if (active)
      [self closeMiniPlayer:identity];
    else if (page != _fullscreenTab && _window.window.isVisible && !_window.window.isMiniaturized)
      [self openMiniPlayer:page identity:identity];
  }
}
- (void)finishDeparture:(NSString *)identity generation:(NSNumber *)generation {
  if (![_departures[identity] isEqual:generation])
    return;
  [_departures removeObjectForKey:identity];
  ArdiaCoreTab *page = _tabs[identity];
  if (!page)
    return;
  page.view.alphaValue = 1;
  for (NSDictionary *pane in _lastSync[@"panes"])
    if ([pane[@"id"] isEqual:identity])
      return;
  if (page.view.superview) [self scheduleFreeze:identity];
  [page noteShownByHost:NO];
  [page.view removeFromSuperview];
}
- (void)window:(ArdiaCoreWindow *)window didActivateTab:(ArdiaCoreTab *)tab {
  if (window != _window || _quitting)
    return;
  // Tab-strip notifications cannot mutate the strip synchronously.
  dispatch_async(dispatch_get_main_queue(), ^{ [self applyLayout]; });
}
- (void)tab:(ArdiaCoreTab *)tab
    didReceivePageMessage:(NSString *)kind
                     json:(NSString *)json
                    frame:(NSString *)frameId
                     main:(BOOL)main
                   origin:(NSString *)origin {
  if ([kind isEqual:@"wing-service-event"] && main && json.length < 10000) {
    for (NSString *profileId in _serviceTabs) {
      if (_serviceTabs[profileId] == tab &&
          [tab.url isEqual:_serviceURLs[profileId]] &&
          [origin isEqual:tab.committedOrigin]) {
        [self send:@"service-event" data:@{@"profileId" : profileId}];
        return;
      }
    }
    return;
  }
  // The engine exposes the message channel to every page. Only this exact local
  // shell document, in its main frame, may invoke host capabilities.
  if (tab != _shell || !main || ![_shell.url isEqual:_shellURL] ||
      ![origin isEqual:_shell.committedOrigin] ||
      (![kind isEqual:@"wing-request"] && ![kind isEqual:@"wing-request-part"]) ||
      json.length > 8000000)
    return;
  if ([kind isEqual:@"wing-request-part"]) {
    // Large requests arrive in order as parts, see src/native-messages.cjs.
    NSDictionary *part = Parse(json);
    if (![part isKindOfClass:NSDictionary.class] ||
        ![part[@"id"] isKindOfClass:NSNumber.class] ||
        ![part[@"index"] isKindOfClass:NSNumber.class] ||
        ![part[@"count"] isKindOfClass:NSNumber.class] ||
        ![part[@"text"] isKindOfClass:NSString.class])
      return;
    NSInteger index = [part[@"index"] integerValue];
    if (index == 0) {
      _requestParts = [NSMutableString new];
      _requestPartsId = part[@"id"];
    } else if (!_requestParts || ![_requestPartsId isEqual:part[@"id"]]) {
      return;
    }
    [_requestParts appendString:part[@"text"]];
    if (_requestParts.length > 8000000) {
      _requestParts = nil;
      return;
    }
    if (index + 1 < [part[@"count"] integerValue])
      return;
    json = _requestParts;
    _requestParts = nil;
  }
  NSDictionary *request = Parse(json);
  if (![request isKindOfClass:NSDictionary.class] ||
      ![request[@"id"] isKindOfClass:NSNumber.class] ||
      [request[@"id"] longLongValue] <= 0 ||
      ![request[@"action"] isKindOfClass:NSString.class] ||
      ![request[@"data"] isKindOfClass:NSDictionary.class])
    return;
  NSNumber *rid = request[@"id"];
  NSString *action = request[@"action"];
  NSDictionary *data = request[@"data"];
  if (_quitting) {
    [self reply:rid result:nil error:@"Browser is closing."];
    return;
  }
  // Private windows keep nothing: no saved workspace, library, profiles,
  // imports, extensions or app-wide settings.
  static NSSet *notPrivate;
  if (!notPrivate)
    notPrivate = [NSSet setWithArray:@[
      @"workspace-recover", @"service", @"delete-profile", @"throwaway-profile",
      @"browser-import", @"browser-profiles", @"extensions-unpacked", @"extensions-reload",
      @"extensions-watch", @"extensions-install", @"extension-capabilities",
      @"download-directory", @"default-browser", @"default-browser-prompt", @"app-icon",
      @"mini-open", @"run-tool", @"metrics", @"trim-memory", @"password-apps",
      @"password-app-open", @"clear-site-data", @"fill-login", @"test-archive-idle",
      @"test-install-unpacked"
    ]];
  if (_private && [notPrivate containsObject:action]) {
    [self reply:rid result:nil error:@"Not available in a private window."];
    return;
  }
  if ([action isEqual:@"window-drag"]) {
    NSEvent *down = _lastMouseDown;
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    if (down && (NSEvent.pressedMouseButtons & 1) &&
        NSProcessInfo.processInfo.systemUptime - down.timestamp < 1)
      [_window.window performWindowDragWithEvent:down];
    return;
  }
  if ([action isEqual:@"window-zoom"]) {
    NSString *behavior = [NSUserDefaults.standardUserDefaults stringForKey:@"AppleActionOnDoubleClick"];
    if ([behavior isEqual:@"Minimize"])
      [_window.window performMiniaturize:nil];
    else if (![behavior isEqual:@"None"])
      [_window.window performZoom:nil];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if (getenv("WING_CHROMIUM_TEST_SCRIPT") &&
      ![@[ @"sync", @"diagnostics", @"evaluate-page", @"extension-actions" ]
          containsObject:action])
    fprintf(stderr, "Qualification request: %s\n", action.UTF8String);
  if ([action isEqual:@"test-minis"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    if ([data[@"close"] boolValue]) [WingMiniWindow closeAll];
    [self reply:rid result:@{@"windows" : WingMiniWindow.diagnostics} error:nil];
    return;
  }
  if ([action isEqual:@"test-private"] && getenv("WING_CHROMIUM_TEST_SCRIPT") && !_private) {
    WingChromiumHost *host = gPrivateHosts.lastObject;
    if ([data[@"open"] boolValue]) {
      [self newPrivateWindow:nil];
      [self reply:rid result:@{@"ok" : @YES} error:nil];
    } else if ([data[@"close"] boolValue]) {
      for (WingChromiumHost *each in [gPrivateHosts copy])
        [each->_window.window performClose:nil];
      [self reply:rid result:@{@"windows" : @(gPrivateHosts.count)} error:nil];
    } else if ([data[@"script"] isKindOfClass:NSString.class] && host) {
      [host->_shell evaluate:data[@"script"]
                  completion:^(NSString *result) {
                    [self reply:rid result:result ?: NSNull.null error:nil];
                  }];
    } else
      [self reply:rid
           result:@{
             @"windows" : @(gPrivateHosts.count),
             @"front" : @(host && [WingChromiumHost keyHost] == host),
             @"offTheRecord" : @(host && host->_profiles[@"private"].offTheRecord),
             @"released" : @(!gLastPrivateProfile || gLastPrivateProfile.destroyed)
           }
            error:nil];
    return;
  }
  if ([action isEqual:@"diagnostics"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    NSMutableArray *tabs = [NSMutableArray new];
    NSMutableArray *protectionPages = [NSMutableArray new];
    for (NSString *identity in _protectionTabs) {
      ArdiaCoreTab *page = _protectionTabs[identity];
      [protectionPages addObject:@{
        @"profile" : identity,
        @"url" : page.url,
        @"origin" : page.committedOrigin ?: @"",
        @"loading" : @(page.loading),
        @"closed" : @(page.closed),
        @"title" : page.title
      }];
    }
    for (NSString *identity in _tabs) {
      ArdiaCoreTab *page = _tabs[identity];
      NSRect bounds = page.view.frame;
      [tabs addObject:@{
        @"id" : identity,
        @"url" : page.url,
        @"profile" : page.profile.name,
        @"visible" : @(page.view.superview != nil && !_departures[identity]),
        @"attachedToWindow" : @(page.view.window == _window.window),
        @"hidden" : @(page.view.hiddenOrHasHiddenAncestor),
        @"devToolsVisible" : @(page.devToolsView.superview != nil),
        @"discarded" : @(page.discarded),
        @"frozen" : @(page.frozen),
        @"x" : @(bounds.origin.x),
        @"y" : @(bounds.origin.y),
        @"width" : @(bounds.size.width),
        @"height" : @(bounds.size.height)
      }];
    }
    [self reply:rid
         result:@{
           @"tabs" : tabs,
           @"shellInternal" : @(_uiWindow.internal),
           @"externalAppRequests" : @(_externalAppAlerts.count),
           @"deviceChoosers" : @(_deviceChoosers.count),
           @"extensionSidebar" : @{
             @"open" : @(_extensionSidebar.page != nil),
             @"visible" : @(_extensionSidebar.page.view.window == _window.window),
             @"title" : _extensionSidebar.page.title ?: @""
           },
           @"downloadDirectoryAPI" :
               @([ArdiaCoreEngine.sharedEngine.defaultProfile
                   respondsToSelector:@selector(setDownloadDirectory:)]),
           @"protectedProfiles" : _protectedProfiles.allObjects,
           @"checkingProtection" : _checkingProtection.allObjects,
           @"protectionPages" : protectionPages,
           @"initializingProfiles" : _protectionTabs.allKeys
         }
          error:nil];
    return;
  }
  if ([action isEqual:@"default-browser"]) {
    if ([[NSBundle.mainBundle objectForInfoDictionaryKey:@"WingQualificationOnly"] boolValue]) {
      [self reply:rid result:nil error:@"Build and install the qualified Wing app before choosing it as your default browser."];
      return;
    }
    NSURL *application = NSBundle.mainBundle.bundleURL;
    [NSWorkspace.sharedWorkspace setDefaultApplicationAtURL:application toOpenURLsWithScheme:@"http"
      completionHandler:^(NSError *error) {
        if (error) {
          dispatch_async(dispatch_get_main_queue(), ^{ [self reply:rid result:nil error:error.localizedDescription]; });
          return;
        }
        [NSWorkspace.sharedWorkspace setDefaultApplicationAtURL:application toOpenURLsWithScheme:@"https"
          completionHandler:^(NSError *secureError) {
            dispatch_async(dispatch_get_main_queue(), ^{
              [self reply:rid result:secureError ? nil : @{@"ok" : @YES} error:secureError.localizedDescription];
            });
          }];
      }];
    return;
  }
  if ([action isEqual:@"bootstrap"] && _private) {
    [self reply:rid
         result:@{
           @"workspace" : NSNull.null,
           @"private" : @YES,
           @"settings" : _privateSettings,
           @"version" : ArdiaCoreEngine.sharedEngine.chromiumVersion
         }
          error:nil];
    return;
  }
  if ([action isEqual:@"bootstrap"]) {
    NSData *saved = [NSData dataWithContentsOfFile:_workspacePath];
    id state = saved ? [NSJSONSerialization JSONObjectWithData:saved
                                                       options:0
                                                         error:nil]
                     : nil;
    NSInteger backup = -1;
    BOOL recovered = NO;
    if (saved && ![state isKindOfClass:NSDictionary.class]) {
      NSDictionary *found = [self recoverWorkspaceAfter:-1];
      state = found[@"workspace"];
      backup = [found[@"index"] integerValue];
      recovered = YES;
    }
    if (!_restorableTabs) {
      _restorableTabs = [NSMutableSet new];
      _restoringTabs = [NSMutableSet new];
      id tabs = [state isKindOfClass:NSDictionary.class] ? state[@"tabs"] : nil;
      for (NSDictionary *record in [tabs isKindOfClass:NSArray.class] ? tabs : @[])
        if ([record isKindOfClass:NSDictionary.class] && [record[@"id"] isKindOfClass:NSString.class])
          [_restorableTabs addObject:record[@"id"]];
    }
    [self reply:rid
         result:@{
           @"workspace" : state ?: NSNull.null,
           @"version" : ArdiaCoreEngine.sharedEngine.chromiumVersion,
           @"backup" : @(backup),
           @"recovered" : @(recovered),
           @"uncleanExit" : @(gUncleanExit)
         }
          error:nil];
    return;
  }
  if ([action isEqual:@"workspace-recover"]) {
    [self reply:rid
         result:[self recoverWorkspaceAfter:[data[@"after"] integerValue]]
          error:nil];
    return;
  }
  if ([action isEqual:@"protection-url"]) {
    NSString *profile = data[@"profile"];
    if (!Identifier(profile) || ![_protectedProfiles containsObject:profile]) {
      [self reply:rid
           result:nil
            error:
                @"Open a page in this profile to initialize protection first."];
      return;
    }
    [self reply:rid result:@{@"url" : _protectionURLs[profile]} error:nil];
    return;
  }
  if ([action isEqual:@"sync"]) {
    NSDictionary *state = data[@"workspace"];
    if (!ValidSync(data)) {
      [self reply:rid result:nil error:@"Invalid workspace layout"];
      return;
    }
    if ([data[@"persist"] boolValue] && !_private) {
      NSError *error;
      NSMutableDictionary *durable = [state mutableCopy];
      NSMutableArray *tabs = [NSMutableArray new];
      for (NSDictionary *record in state[@"tabs"])
        if (![record[@"transient"] boolValue])
          [tabs addObject:record];
      durable[@"tabs"] = tabs;
      NSData *body = [NSJSONSerialization dataWithJSONObject:durable
                                                     options:0
                                                       error:&error];
      if (!body || !SaveWorkspace(body, _workspacePath)) {
        [self reply:rid result:nil error:@"Workspace could not be saved."];
        return;
      }
      [self backupWorkspace:body force:NO];
    }
    _lastSync = data;
    // Wing runs the mini player itself; Chromium's own automatic picture in
    // picture stays off so a page never floats twice.
    _automaticPictureInPicture = [state[@"settings"][@"automaticPictureInPicture"] boolValue];
    // Wing's mode reaches window controls and each page's prefers-color-scheme.
    NSString *appearance = state[@"settings"][@"appearance"];
    if (![appearance isKindOfClass:NSString.class])
      appearance = [state[@"settings"][@"dark"] boolValue] ? @"dark" : @"light";
    NSAppearanceName appearanceName = [appearance isEqual:@"dark"]    ? NSAppearanceNameDarkAqua
                                      : [appearance isEqual:@"light"] ? NSAppearanceNameAqua
                                                                      : nil;
    if (!_private && ![NSApp.appearance.name isEqual:appearanceName] &&
        (NSApp.appearance || appearanceName)) {
      NSApp.appearance = appearanceName ? [NSAppearance appearanceNamed:appearanceName] : nil;
      [self relayoutTrafficLightsSoon];
    }
    [self applyLayout];
    [self orderShell];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    for (NSString *url in [_externalURLs copy])
      [self send:@"action"
            data:@{
              @"name" : @"external-url",
              @"args" : @{@"url" : url, @"space" : _externalSpaces[url] ?: @""}
            }];
    [_externalURLs removeAllObjects];
    [_externalSpaces removeAllObjects];
    return;
  }
  if ([action isEqual:@"raise-shell"]) {
    // The transparent shell sits behind pages; overlays lift it over the live page.
    _shellRaised = [data[@"raised"] boolValue];
    [self orderShell];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"metrics"]) {
    NSUInteger sleeping = 0;
    for (ArdiaCoreTab *page in _tabs.allValues)
      if (page.discarded)
        sleeping++;
    [self reply:rid
         result:@{
           @"liveViews" : @(_tabs.count - sleeping),
           @"sleepingTabs" : @(sleeping),
           @"totalTabs" : @([_lastSync[@"workspace"][@"tabs"] count]),
           @"processes" : [self processMetrics]
         }
          error:nil];
    return;
  }
  if ([action isEqual:@"test-install-unpacked"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    CallEngine("ac_extensions_install", _profiles[data[@"profile"]], @{@"path" : data[@"path"]}, ^(NSDictionary *reply) {
      [self reply:rid result:reply error:nil];
    });
    return;
  }
  if ([action isEqual:@"test-archive-idle"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    [self archiveIdlePagesAt:[data[@"now"] doubleValue] completion:^{
      [self reply:rid result:@{@"ok" : @YES} error:nil];
    }];
    return;
  }
  if ([action isEqual:@"trim-memory"]) {
    [self trimMemoryAutomatic:NO
                   completion:^{
                     [self reply:rid result:@{@"ok" : @YES} error:nil];
                   }];
    return;
  }
  if ([action isEqual:@"run-tool"]) {
    [self runTool:data reply:rid];
    return;
  }
  if ([action isEqual:@"mini-open"]) {
    [self openMini:data reply:rid];
    return;
  }
  if ([action isEqual:@"emoji-panel"]) {
    [NSApp orderFrontCharacterPalette:nil];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"clipboard-read"]) {
    [self reply:rid
         result:@{@"text" : [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString] ?: @""}
          error:nil];
    return;
  }
  if ([action isEqual:@"app-icon"]) {
    NSSet *known = [NSSet setWithArray:@[ @"violet", @"midnight", @"paper", @"coral", @"ocean", @"forest", @"gold" ]];
    if (![known containsObject:data[@"icon"]]) {
      [self reply:rid result:nil error:@"Unknown app icon."];
      return;
    }
    NSString *path = [NSBundle.mainBundle pathForResource:data[@"icon"]
                                                   ofType:@"png"
                                              inDirectory:@"assets/icons"];
    NSImage *image = path ? [[NSImage alloc] initWithContentsOfFile:path] : nil;
    if (image) NSApp.applicationIconImage = image;
    if (image) [self stampBundleIcon:data[@"icon"] image:image];
    [self reply:rid result:@{@"ok" : @(image != nil)} error:nil];
    return;
  }
  if ([action isEqual:@"confirm"]) {
    NSAlert *alert = [NSAlert new];
    alert.alertStyle = NSAlertStyleWarning;
    alert.messageText = [data[@"message"] isKindOfClass:NSString.class] ? data[@"message"] : @"Are you sure?";
    alert.informativeText = [data[@"detail"] isKindOfClass:NSString.class] ? data[@"detail"] : @"";
    [alert addButtonWithTitle:[data[@"button"] isKindOfClass:NSString.class] ? data[@"button"] : @"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    alert.buttons.lastObject.keyEquivalent = @"\r";
    alert.buttons.firstObject.keyEquivalent = @"";
    [alert beginSheetModalForWindow:_window.window
                  completionHandler:^(NSModalResponse response) {
                    [self reply:rid
                         result:@{@"confirmed" : @(response == NSAlertFirstButtonReturn)}
                          error:nil];
                  }];
    return;
  }
  if ([action isEqual:@"default-browser-prompt"]) {
    NSURL *current = [NSWorkspace.sharedWorkspace
        URLForApplicationToOpenURL:[NSURL URLWithString:@"https://example.com"]];
    if ([[NSBundle.mainBundle objectForInfoDictionaryKey:@"WingQualificationOnly"] boolValue] ||
        getenv("WING_CHROMIUM_TEST_SCRIPT") ||
        [current.path isEqual:NSBundle.mainBundle.bundleURL.path]) {
      [self reply:rid result:@{@"skipped" : @YES} error:nil];
      return;
    }
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Make Wing your default browser?";
    alert.informativeText = @"Links from other apps will open in Wing.";
    [alert addButtonWithTitle:@"Use Wing"];
    [alert addButtonWithTitle:@"Not Now"];
    alert.showsSuppressionButton = YES;
    alert.suppressionButton.title = @"Don't ask again";
    [alert beginSheetModalForWindow:_window.window
                  completionHandler:^(NSModalResponse response) {
                    BOOL use = response == NSAlertFirstButtonReturn;
                    [self reply:rid
                         result:@{
                           @"use" : @(use),
                           @"off" : @(!use && alert.suppressionButton.state == NSControlStateValueOn)
                         }
                          error:nil];
                  }];
    return;
  }
  if ([action isEqual:@"throwaway-profile"]) {
    NSString *identity = data[@"id"];
    if (!Identifier(identity) || [identity isEqual:@"default"] || [identity isEqual:@"work"]) {
      [self reply:rid result:nil error:@"This profile can't be thrown away."];
      return;
    }
    // Queued up front, so a crash can't leave a throwaway profile's data behind.
    NSMutableArray *queued = [self.deletedProfiles mutableCopy];
    if (![queued containsObject:identity])
      [queued addObject:identity];
    BOOL saved = [self saveDeletedProfiles:queued];
    [self reply:rid result:saved ? @{@"ok" : @YES} : nil error:saved ? nil : @"Profile could not be queued."];
    return;
  }
  if ([action isEqual:@"focus-shell"]) {
    [_shell focus];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"password-apps"] || [action isEqual:@"password-app-open"]) {
    NSDictionary *bundles = @{
      @"1Password" : @"com.1password.1password",
      @"1Password 7" : @"com.agilebits.onepassword7",
      @"Bitwarden" : @"com.bitwarden.desktop",
      @"Dashlane" : @"com.dashlane.dashlanephonefinal",
      @"Enpass" : @"in.sinew.Enpass-Desktop",
      @"Passwords" : @"com.apple.Passwords",
      @"Proton Pass" : @"me.proton.pass.electron"
    };
    NSWorkspace *apps = NSWorkspace.sharedWorkspace;
    if ([action isEqual:@"password-apps"]) {
      NSMutableArray *found = [NSMutableArray new];
      for (NSString *name in [bundles.allKeys sortedArrayUsingSelector:@selector(compare:)])
        if ([apps URLForApplicationWithBundleIdentifier:bundles[name]])
          [found addObject:name];
      [self reply:rid result:@{@"apps" : found} error:nil];
      return;
    }
    NSString *identifier = [data[@"name"] isKindOfClass:NSString.class] ? bundles[data[@"name"]] : nil;
    NSURL *application = identifier ? [apps URLForApplicationWithBundleIdentifier:identifier] : nil;
    if (!application) {
      [self reply:rid result:nil error:@"That password manager isn't installed."];
      return;
    }
    [apps openApplicationAtURL:application
                 configuration:[NSWorkspaceOpenConfiguration configuration]
             completionHandler:nil];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"extensions-unpacked"] || [action isEqual:@"extensions-reload"] ||
      [action isEqual:@"extensions-watch"]) {
    NSString *profileId = data[@"profile"];
    ArdiaCoreProfile *profile = Identifier(profileId) ? _profiles[profileId] : nil;
    if (!profile) {
      [self reply:rid result:nil error:@"Open a page in this profile first."];
      return;
    }
    ListExtensions(profile, ^(NSArray<NSDictionary *> *list) {
      NSMutableArray *unpacked = [NSMutableArray new];
      for (NSDictionary *extension in list)
        if ([extension[@"location"] isEqual:@"UNPACKED"] && [extension[@"path"] length])
          [unpacked addObject:extension];
      if ([action isEqual:@"extensions-unpacked"]) {
        [self reply:rid
             result:@{@"extensions" : unpacked, @"watching" : @(self->_extensionWatches[profileId] != nil)}
              error:nil];
      } else if ([action isEqual:@"extensions-reload"]) {
        for (NSDictionary *extension in unpacked)
          CallEngine("ac_extensions_reload", profile, @{@"id" : extension[@"id"]}, ^(NSDictionary *reply){
          });
        [self reply:rid result:@{@"count" : @(unpacked.count)} error:nil];
      } else {
        BOOL on = [self watchExtensions:unpacked profile:profileId enabled:[data[@"on"] boolValue]];
        [self reply:rid result:@{@"watching" : @(on), @"count" : @(unpacked.count)} error:nil];
      }
    });
    return;
  }
  if ([action isEqual:@"open-in-browser"]) {
    NSDictionary *bundles = @{
      @"Safari" : @"com.apple.Safari",
      @"Google Chrome" : @"com.google.Chrome",
      @"Firefox" : @"org.mozilla.firefox"
    };
    NSString *identifier = [data[@"browser"] isKindOfClass:NSString.class] ? bundles[data[@"browser"]] : nil;
    NSURL *application = identifier ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:identifier] : nil;
    if (!application || !WebURL(data[@"url"])) {
      [self reply:rid result:nil error:@"That browser could not open this page."];
      return;
    }
    [NSWorkspace.sharedWorkspace openURLs:@[ [NSURL URLWithString:data[@"url"]] ]
                     withApplicationAtURL:application
                            configuration:[NSWorkspaceOpenConfiguration configuration]
                        completionHandler:nil];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"private-window"]) {
    [self newPrivateWindow:nil];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"context-menu"]) {
    if (![data[@"items"] isKindOfClass:NSArray.class]) {
      [self reply:rid result:nil error:@"Invalid menu."];
      return;
    }
    // Entries: {separator}, {title, items} for a submenu, or {title, kind, data}
    // with optional symbol and checked. Bounded so a page cannot build huge menus.
    __block NSUInteger budget = 60;
    __block NSMenu * (^build)(NSArray *, NSUInteger) = nil;
    NSMenu * (^builder)(NSArray *, NSUInteger) = ^NSMenu *(NSArray *entries, NSUInteger depth) {
      NSMenu *menu = [NSMenu new];
      menu.autoenablesItems = NO;
      for (NSDictionary *entry in entries) {
        if (!budget--) break;
        if (![entry isKindOfClass:NSDictionary.class]) continue;
        if ([entry[@"separator"] isEqual:@YES]) {
          if (menu.numberOfItems && !menu.itemArray.lastObject.isSeparatorItem)
            [menu addItem:NSMenuItem.separatorItem];
          continue;
        }
        if (![entry[@"title"] isKindOfClass:NSString.class]) continue;
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:entry[@"title"]
                                                      action:nil
                                               keyEquivalent:@""];
        if ([entry[@"items"] isKindOfClass:NSArray.class]) {
          if (depth > 1) continue;
          item.submenu = build(entry[@"items"], depth + 1);
          item.enabled = item.submenu.numberOfItems > 0;
        } else if ([entry[@"data"] isKindOfClass:NSDictionary.class]) {
          item.action = @selector(contextAction:);
          item.target = self;
          item.representedObject = entry;
          item.enabled = ![entry[@"disabled"] isEqual:@YES];
        } else
          continue;
        if ([entry[@"symbol"] isKindOfClass:NSString.class])
          item.image = [NSImage imageWithSystemSymbolName:entry[@"symbol"]
                                 accessibilityDescription:nil];
        if ([entry[@"checked"] isEqual:@YES]) item.state = NSControlStateValueOn;
        [menu addItem:item];
      }
      if (menu.itemArray.lastObject.isSeparatorItem)
        [menu removeItem:menu.itemArray.lastObject];
      return menu;
    };
    build = builder;
    NSMenu *menu = build(data[@"items"], 0);
    build = nil;
    [menu popUpMenuPositioningItem:nil
                        atLocation:NSEvent.mouseLocation
                            inView:nil];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  if ([action isEqual:@"browser-profiles"] ||
      [action isEqual:@"browser-import"]) {
    if (_importProcess) {
      [self reply:rid result:nil error:@"A browser import is already running."];
      return;
    }
    _importProfiles = [NSMutableSet new];
    NSMutableSet *existing = [NSMutableSet new];
    for (NSDictionary *profile in _lastSync[@"workspace"][@"profiles"])
      [existing addObject:profile[@"id"]];
    _importExistingProfiles = existing;
    _importCommitted = NO;
    _importProcess = [WingImportProcess new];
    NSMutableDictionary *input = [@{
      @"kind" : @"start",
      @"operation" : [action isEqual:@"browser-profiles"] ? @"profiles"
                                                          : @"import"
    } mutableCopy];
    if ([action isEqual:@"browser-import"]) {
      input[@"source"] = data[@"source"] ?: @"";
      input[@"options"] = data[@"options"] ?: @{};
      input[@"state"] = _lastSync[@"workspace"];
    }
    [_importProcess start:input
        request:^(NSDictionary *request, WingImportReply reply) {
          [self handleImportRequest:request reply:reply];
        }
        completion:^(id result, NSString *error) {
          self->_importProcess = nil;
          if (error && !self->_importCommitted)
            for (NSString *profile in self->_importProfiles)
              [self rollbackImportProfile:profile
                               completion:^(id ignored, NSString *failure){
                               }];
          [self reply:rid result:result error:error];
        }];
    return;
  }
  if ([action isEqual:@"delete-profile"]) {
    NSString *identity = data[@"id"];
    BOOL live = [[_lastSync[@"workspace"][@"profiles"] valueForKey:@"id"]
        containsObject:identity];
    for (NSDictionary *space in _lastSync[@"workspace"][@"spaces"])
      live = live || [space[@"profileId"] isEqual:identity];
    if (!Identifier(identity) || [identity isEqual:@"default"] ||
        [identity isEqual:@"work"] || live || _importProcess) {
      [self reply:rid result:nil error:@"This profile can't be deleted."];
      return;
    }
    [self deleteProfileData:identity reply:rid];
    return;
  }
  if ([action isEqual:@"file-save"]) {
    if (![data[@"text"] isKindOfClass:NSString.class] ||
        ![data[@"name"] isKindOfClass:NSString.class]) {
      [self reply:rid result:nil error:@"Invalid export."];
      return;
    }
    [self saveData:[data[@"text"] dataUsingEncoding:NSUTF8StringEncoding]
              name:data[@"name"]
             reply:rid];
    return;
  }
  if ([action isEqual:@"file-read"] || [action isEqual:@"directory"]) {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    BOOL directory = [action isEqual:@"directory"];
    panel.canChooseDirectories = directory;
    panel.canChooseFiles = !directory;
    panel.allowsMultipleSelection = NO;
    [panel beginSheetModalForWindow:_window.window
                  completionHandler:^(NSModalResponse response) {
                    if (response != NSModalResponseOK) {
                      [self reply:rid result:@{@"cancelled" : @YES} error:nil];
                      return;
                    }
                    if (directory) {
                      [self reply:rid
                           result:@{@"path" : panel.URL.path}
                            error:nil];
                      return;
                    }
                    NSNumber *size;
                    [panel.URL getResourceValue:&size
                                         forKey:NSURLFileSizeKey
                                          error:nil];
                    if (size.unsignedLongLongValue > 8000000) {
                      [self reply:rid
                           result:nil
                            error:@"Workspace import exceeds 8 MB."];
                      return;
                    }
                    NSError *error;
                    NSString *text =
                        [NSString stringWithContentsOfURL:panel.URL
                                                 encoding:NSUTF8StringEncoding
                                                    error:&error];
                    [self reply:rid
                         result:@{@"text" : text ?: @""}
                          error:error.localizedDescription];
                  }];
    return;
  }
  if ([action isEqual:@"extensions-install"] ||
      ([action isEqual:@"extension-capabilities"] &&
       getenv("WING_CHROMIUM_TEST_SCRIPT"))) {
    NSString *profile = data[@"profile"];
    if (!Identifier(profile)) {
      [self reply:rid result:nil error:@"Invalid profile."];
      return;
    }
    [self extensionManager:profile
                   inspect:[action isEqual:@"extension-capabilities"]
                     reply:rid
                  attempts:400];
    return;
  }
  if ([action isEqual:@"service"]) {
    NSString *profileId = data[@"profile"];
    BOOL known = NO;
    for (NSDictionary *profile in _lastSync[@"workspace"][@"profiles"])
      if ([profile[@"id"] isEqual:profileId])
        known = YES;
    if (!known || !Identifier(profileId) ||
        ![data[@"method"] isKindOfClass:NSString.class] ||
        ![data[@"args"] isKindOfClass:NSDictionary.class]) {
      [self reply:rid result:nil error:@"Invalid browser service request."];
      return;
    }
    [self service:data profile:profileId reply:rid attempts:400];
    return;
  }
  if ([action isEqual:@"extension-actions"]) {
    NSString *active = _lastSync[@"workspace"][@"activeTabId"];
    ArdiaCoreTab *page = active ? _tabs[active] : nil;
    ListExtensions(page.profile, ^(NSArray<NSDictionary *> *extensions) {
      NSMutableArray *enabled = [NSMutableArray new];
      for (NSDictionary *extension in extensions)
        if ([extension[@"enabled"] boolValue])
          [enabled addObject:extension];
      NSMutableArray *items = [NSMutableArray new];
      NSDictionary *states = page.closed ? @{} : [page actionStatesForExtensions:[enabled valueForKey:@"id"]];
      for (NSDictionary *extension in enabled) {
        NSDictionary *state = states[extension[@"id"]];
        if (!state)
          continue;
        NSMutableDictionary *item = [extension mutableCopy];
        [item addEntriesFromDictionary:state];
        // An action without an icon of its own for this tab shows the extension's.
        if (![state[@"icon"] length] && [extension[@"icon"] length])
          item[@"icon"] = extension[@"icon"];
        [items addObject:item];
      }
      [self reply:rid result:@{@"extensions" : items} error:nil];
    });
    return;
  }
  if ([action isEqual:@"image-export"]) {
    NSString *encoded = data[@"png"];
    NSData *body = [encoded isKindOfClass:NSString.class] && encoded.length <= 7000000
      ? [[NSData alloc] initWithBase64EncodedString:encoded options:0] : nil;
    const unsigned char signature[] = {137,80,78,71,13,10,26,10};
    // Read PNG dimensions before asking AppKit to decode an allocation.
    const unsigned char *bytes = static_cast<const unsigned char *>(body.bytes);
    uint32_t width = 0, height = 0;
    if (body.length >= 24 && memcmp(bytes, signature, 8) == 0 && memcmp(bytes+12, "IHDR", 4) == 0) {
      for (int i=0;i<4;i++) { width=(width<<8)|bytes[16+i]; height=(height<<8)|bytes[20+i]; }
    }
    if (!width || !height || width > 32767 || height > 32767 || (uint64_t)width*height > 64000000 ||
        ![@[@"file", @"clipboard"] containsObject:data[@"destination"]] ||
        ![NSBitmapImageRep imageRepWithData:body]) {
      [self reply:rid result:nil error:@"Invalid or oversized capture image."]; return;
    }
    if (getenv("WING_CHROMIUM_TEST_SCRIPT") && [data[@"inspectCapture"] boolValue]) {
      [self reply:rid result:@{@"ok":@YES, @"width":@(width), @"height":@(height)} error:nil]; return;
    }
    if ([data[@"destination"] isEqual:@"clipboard"]) {
      [NSPasteboard.generalPasteboard clearContents];
      BOOL copied = [NSPasteboard.generalPasteboard setData:body forType:NSPasteboardTypePNG];
      [self reply:rid result:@{@"ok":@(copied)} error:copied ? nil : @"The image could not be copied."];
    } else [self saveData:body name:@"Wing-capture.png" reply:rid];
    return;
  }
  if ([action isEqual:@"icloud-sync-read"] || [action isEqual:@"icloud-sync-write"]) {
    // Only Wing/Sync.json in iCloud Drive and the local base beside the workspace.
    NSFileManager *files = NSFileManager.defaultManager;
    NSString *drive = getenv("WING_ICLOUD_SYNC_DIR")
                          ? @(getenv("WING_ICLOUD_SYNC_DIR"))
                          : [NSHomeDirectory() stringByAppendingPathComponent:
                                                   @"Library/Mobile Documents/com~apple~CloudDocs"];
    NSString *folder = [drive stringByAppendingPathComponent:@"Wing"];
    NSString *file = [folder stringByAppendingPathComponent:@"Sync.json"];
    NSString *basePath = [_workspacePath.stringByDeletingLastPathComponent
        stringByAppendingPathComponent:@"wing-sync-base.json"];
    BOOL isFolder = NO;
    if (_private || ![files fileExistsAtPath:drive isDirectory:&isFolder] || !isFolder) {
      [self reply:rid
           result:nil
            error:@"iCloud Drive is off on this Mac. Turn it on in System Settings → Apple Account → iCloud."];
      return;
    }
    id (^readJSON)(NSString *) = ^id(NSString *path) {
      NSData *body = [NSData dataWithContentsOfFile:path];
      id value = body.length && body.length < 5000000
                     ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil]
                     : nil;
      return [value isKindOfClass:NSDictionary.class] ? value : NSNull.null;
    };
    if ([action isEqual:@"icloud-sync-read"]) {
      // A file another Mac wrote may still be in the cloud only; ask for it.
      [files startDownloadingUbiquitousItemAtURL:[NSURL fileURLWithPath:file] error:nil];
      [self reply:rid result:@{@"remote" : readJSON(file), @"base" : readJSON(basePath)} error:nil];
      return;
    }
    BOOL ok = YES;
    for (NSArray *pair in @[ @[ @"file", file ], @[ @"base", basePath ] ]) {
      id value = data[pair[0]];
      if (![value isKindOfClass:NSDictionary.class])
        continue;
      NSData *body = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
      if (!body || body.length >= 5000000) {
        ok = NO;
        continue;
      }
      [files createDirectoryAtPath:[pair[1] stringByDeletingLastPathComponent]
          withIntermediateDirectories:YES
                           attributes:nil
                                error:nil];
      ok = [body writeToFile:pair[1] atomically:YES] && ok;
    }
    [self reply:rid result:ok ? @{@"ok" : @YES} : nil error:ok ? nil : @"Wing couldn't write to iCloud Drive."];
    return;
  }
  if ([action isEqual:@"clipboard"]) {
    if (![data[@"text"] isKindOfClass:NSString.class])
      return;
    [NSPasteboard.generalPasteboard clearContents];
    [NSPasteboard.generalPasteboard setString:data[@"text"]
                                      forType:NSPasteboardTypeString];
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  WingWebKitPage *webkit = Identifier(data[@"id"]) ? _webkitPages[data[@"id"]] : nil;
  if (webkit) {
    if ([action isEqual:@"close"]) {
      [webkit close];
      [_webkitPages removeObjectForKey:data[@"id"]];
      [_modelURLs removeObjectForKey:data[@"id"]];
      [self reply:rid result:@{@"pending" : @NO} error:nil];
      return;
    }
    if ([action isEqual:@"test-webkit"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
      [webkit evaluate:@"let fps = false; try { await navigator.requestMediaKeySystemAccess('com.apple.fps', "
                       @"[{initDataTypes:['sinf','skd'],videoCapabilities:[{contentType:'video/mp4;codecs=\"avc1.42E01E\"'}]}]); "
                       @"fps = true } catch (e) { fps = String(e) } return JSON.stringify({fps, ua: navigator.userAgent})"
            completion:^(id value) {
              [self reply:rid
                   result:@{
                     @"url" : webkit.url,
                     @"title" : webkit.title,
                     @"shown" : @(webkit.view.superview == self->_window.hostView),
                     @"chromium" : @(self->_tabs[data[@"id"]] != nil),
                     @"js" : [value description] ?: @""
                   }
                    error:nil];
            }];
      return;
    }
    NSDictionary<NSString *, NSString *> *simple = @{
      @"back" : @"goBack", @"forward" : @"goForward", @"reload" : @"reload",
      @"dev-reload" : @"reload", @"stop" : @"stop", @"focus" : @"focus"
    };
    if (!simple[action]) {
      [self reply:rid result:nil error:@"This page plays in WebKit, which doesn't support that."];
      return;
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [webkit performSelector:NSSelectorFromString(simple[action])];
#pragma clang diagnostic pop
    [self reply:rid result:@{@"ok" : @YES} error:nil];
    return;
  }
  ArdiaCoreTab *page = Identifier(data[@"id"]) ? _tabs[data[@"id"]] : nil;
  [self thaw:page];
  if ([action isEqual:@"close"]) {
    if (page && !page.closed) {
      _closing[data[@"id"]] = @([data[@"archive"] boolValue]);
      [page close];
    }
    [self reply:rid result:@{@"pending" : @(page != nil)} error:nil];
    return;
  }
  if (!page || page.closed) {
    [self reply:rid result:nil error:@"Open a page first."];
    return;
  }
  if ([action isEqual:@"test-cancel-device"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    [self cancelDeviceRequestsForTab:page];
    [self reply:rid result:@{@"ok":@YES} error:nil];
    return;
  }
  if ([action isEqual:@"test-cancel-external"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    [self cancelExternalRequestsForTab:page];
    [self reply:rid result:@{@"ok":@YES} error:nil];
    return;
  }
  if ([action isEqual:@"test-extension"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    NSString *operation = data[@"operation"];
    if ([operation isEqual:@"load"] && getenv("WING_CHROMIUM_TEST_EXTENSION")) {
      NSString *identity = [page.profile loadComponentExtension:@(getenv("WING_CHROMIUM_TEST_EXTENSION"))];
      [self reply:rid result:@{@"extensionId" : identity ?: @""} error:nil];
    } else if ([operation isEqual:@"open"]) {
      [self reply:rid result:@{@"ok" : @([self showExtensionSidebar:data[@"extensionId"] tab:page])} error:nil];
    } else if ([operation isEqual:@"close"]) {
      [_extensionSidebar close];
      [self applyLayout];
      [self reply:rid result:@{@"ok" : @YES} error:nil];
    } else {
      [self reply:rid result:nil error:@"Unknown fixture operation."];
    }
    return;
  }
  if ([action isEqual:@"site-cookies"]) {
    if (!WebURL(page.url)) {
      [self reply:rid result:nil error:@"Open a website first."];
      return;
    }
    BOOL remove = [data[@"operation"] isEqual:@"delete"];
    if (remove && !([data[@"name"] isKindOfClass:NSString.class] && [data[@"domain"] isKindOfClass:NSString.class] &&
                    [data[@"path"] isKindOfClass:NSString.class])) {
      [self reply:rid result:nil error:@"Invalid cookie."];
      return;
    }
    [page devToolsCall:remove ? @"Network.deleteCookies" : @"Network.getCookies"
                params:remove ? @{@"name" : data[@"name"], @"domain" : data[@"domain"], @"path" : data[@"path"]}
                              : @{@"urls" : @[ page.url ]}
               timeout:0
            completion:^(NSDictionary *result, NSString *error) {
              [self reply:rid result:error ? nil : (result[@"cookies"] ? @{@"cookies" : result[@"cookies"]} : @{@"ok" : @YES}) error:error];
            }];
    return;
  }
  if ([action isEqual:@"page-json"]) {
    NSString *script = @"(()=>{const text=(document.querySelector('body>pre')||document.body||{}).textContent||'';"
                       @"return{type:document.contentType,text:text.slice(0,5000000),"
                       @"truncated:text.length>5000000}})()";
    [page devToolsCall:@"Runtime.evaluate"
                params:@{@"expression" : script, @"returnByValue" : @YES}
               timeout:0
            completion:^(NSDictionary *result, NSString *error) {
              [self reply:rid result:error ? nil : (result[@"result"][@"value"] ?: @{}) error:error];
            }];
    return;
  }
  if ([action isEqual:@"adblock-site"]) {
    NSString *origin = page.committedOrigin;
    NSString *host = WebURL(page.url) ? [NSURL URLWithString:page.url].host : nil;
    NSString *profileId = nil;
    for (NSString *key in _profiles)
      if (_profiles[key] == page.profile)
        profileId = key;
    if (!host.length || !origin || !_protectionURLs[profileId] || _protectionTabs[profileId]) {
      [self reply:rid result:nil error:@"Content blocking isn't ready for this page."];
      return;
    }
    id allow = [data[@"allow"] isKindOfClass:NSNumber.class] ? data[@"allow"] : NSNull.null;
    ArdiaCoreTab *helper = [_window openTab:_protectionURLs[profileId] profile:page.profile foreground:NO];
    [self allowlist:helper host:host allow:allow reply:rid attempts:400];
    return;
  }
  if ([action isEqual:@"evaluate-page"] &&
      getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    if (![data[@"script"] isKindOfClass:NSString.class])
      return;
    if ([data[@"userGesture"] boolValue]) {
      [page
          devToolsCall:@"Runtime.evaluate"
                params:@{@"expression" : data[@"script"], @"userGesture" : @YES}
               timeout:0
            completion:^(NSDictionary *result, NSString *error) {
              [self reply:rid result:result error:error];
            }];
      return;
    }
    [page evaluate:data[@"script"]
        completion:^(NSString *result) {
          [self reply:rid result:result ?: NSNull.null error:nil];
        }];
    return;
  }
  if ([action isEqual:@"download-directory"]) {
    NSString *path = data[@"path"];
    BOOL isDirectory = NO;
    if (![path isKindOfClass:NSString.class] || !path.isAbsolutePath ||
        ![NSFileManager.defaultManager fileExistsAtPath:path
                                            isDirectory:&isDirectory] ||
        !isDirectory) {
      [self reply:rid
           result:nil
            error:@"Choose an existing download directory."];
      return;
    }
    if (![page.profile respondsToSelector:@selector(setDownloadDirectory:)]) {
      [self reply:rid
           result:nil
            error:@"Custom download directories require Wing's source-built "
                  @"engine."];
      return;
    }
    BOOL saved = [page.profile setDownloadDirectory:path];
    [self reply:rid
         result:@{@"ok" : @(saved)}
          error:saved ? nil
                      : @"The download directory could not be changed (it may "
                        @"be managed by policy)."];
    return;
  }
  if ([action isEqual:@"clear-site-data"]) {
    NSString *url = page.url;
    if (![url hasPrefix:@"http://"] && ![url hasPrefix:@"https://"]) {
      [self reply:rid result:nil error:@"Open a website first."];
      return;
    }
    NSAlert *alert = [NSAlert new];
    alert.messageText =
        [NSString stringWithFormat:@"Clear data for %@?", page.committedOrigin];
    alert.informativeText = @"This signs you out and removes this site's "
                            @"stored data. Other sites are unaffected.";
    [alert addButtonWithTitle:@"Cancel"];
    [alert addButtonWithTitle:@"Clear site data"];
    [alert
        beginSheetModalForWindow:_window.window
               completionHandler:^(NSModalResponse response) {
                 if (response != NSAlertSecondButtonReturn || page.closed ||
                     ![page.url isEqual:url]) {
                   [self reply:rid result:@{@"cancelled" : @YES} error:nil];
                   return;
                 }
                 for (NSString *profileId in self->_profiles)
                   if (self->_profiles[profileId] == page.profile) {
                     [self service:@{
                       @"method" : @"clear-site-data",
                       @"args" : @{@"url" : url}
                     }
                           profile:profileId
                             reply:rid
                          attempts:400];
                     return;
                   }
                 [self reply:rid
                      result:nil
                       error:@"The requesting profile is no longer available."];
               }];
    return;
  }
  if ([action isEqual:@"picture-in-picture"]) {
    if ([data[@"close"] boolValue]) {
      [page exitPictureInPicture]; [self reply:rid result:@{@"ok":@YES} error:nil];
    } else // Only the verified local shell can invoke this user action. Chromium uses
    // the monotonic request time to reject a document replaced during dispatch.
    [page enterPictureInPictureForClickAt:NSProcessInfo.processInfo.systemUptime completion:^(NSString *route, BOOL opened) {
      [self reply:rid result:@{@"ok":@(opened || [route isEqual:@"session"])}
        error:opened || [route isEqual:@"session"] ? nil : @"Play a video on this page first."];
    }];
    return;
  }
  if ([action isEqual:@"test-cast"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    if ([data[@"choose"] isKindOfClass:NSNumber.class])
      [_castPicker chooseSinkAtIndex:[data[@"choose"] integerValue]];
    [self reply:rid result:@{@"picker" : @(_castPicker != nil), @"state" : _castPicker.state ?: @{}} error:nil];
    return;
  }
  if ([action isEqual:@"test-fullscreen"] && getenv("WING_CHROMIUM_TEST_SCRIPT")) {
    // A click inside the page gives it the user activation fullscreen needs.
    if ([data[@"click"] boolValue] && page.view.window) {
      NSWindow *window = page.view.window;
      [NSApp activateIgnoringOtherApps:YES];
      [window makeKeyAndOrderFront:nil];
      NSPoint point = [page.view convertPoint:NSMakePoint(NSMidX(page.view.bounds), NSMidY(page.view.bounds))
                                       toView:nil];
      NSView *target = [window.contentView.superview hitTest:point];
      NSLog(@"test-fullscreen click target %@", target);
      for (NSEventType type : {NSEventTypeLeftMouseDown, NSEventTypeLeftMouseUp}) {
        NSEvent *event = [NSEvent mouseEventWithType:type location:point modifierFlags:0
                                           timestamp:NSProcessInfo.processInfo.systemUptime
                                        windowNumber:window.windowNumber context:nil
                                         eventNumber:0 clickCount:1 pressure:1];
        if (type == NSEventTypeLeftMouseDown)
          [target mouseDown:event];
        else
          [target mouseUp:event];
      }
    }
    if ([data[@"exit"] boolValue])
      [page exitFullscreen];
    if ([data[@"simulate"] isKindOfClass:NSNumber.class])
      [self window:_window tab:page didChangeFullscreen:[data[@"simulate"] boolValue]];
    [page evaluate:@"post('result',JSON.stringify([String(window.fs),!!document.fullscreenElement,innerWidth,innerHeight]))"
        completion:^(NSString *json) {
          [self reply:rid
               result:@{
                 @"tab" : @(self->_fullscreenTab == page),
                 @"window" : @((self->_window.window.styleMask & NSWindowStyleMaskFullScreen) != 0),
                 @"page" : NSStringFromRect(page.view.frame),
                 @"host" : NSStringFromRect(self->_window.hostView.bounds),
                 @"screen" : NSStringFromRect(self->_window.window.screen.frame),
                 @"front" : @(self->_window.hostView.subviews.lastObject == page.view),
                 @"js" : json ?: @""
               }
                error:nil];
        }];
    return;
  }
  if ([action isEqual:@"cast"]) {
    if ([data[@"stop"] isKindOfClass:NSString.class]) {
      [ArdiaCoreEngine terminateCastRoute:data[@"stop"]];
      [self reply:rid result:@{@"ok" : @YES} error:nil];
      return;
    }
    BOOL shown = WebURL(page.url) && [page showCastDialog];
    [self reply:rid result:shown ? @{@"ok" : @YES} : nil
          error:shown ? nil : @"Open a web page to cast it."];
    return;
  }
  if ([action isEqual:@"reader"]) {
    NSString *folder = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"reader"];
    NSString *library = [NSString stringWithContentsOfFile:[folder stringByAppendingPathComponent:@"Readability.js"]
                                                  encoding:NSUTF8StringEncoding
                                                     error:nil];
    NSString *toggle = [NSString stringWithContentsOfFile:[folder stringByAppendingPathComponent:@"reader.js"]
                                                 encoding:NSUTF8StringEncoding
                                                    error:nil];
    if (!library || !toggle || ![page.url hasPrefix:@"http"]) {
      [self reply:rid result:@{@"reader" : @NO, @"unavailable" : @YES} error:nil];
      return;
    }
    NSString *script = [NSString
        stringWithFormat:@"post('result',JSON.stringify((()=>{try{%@\n%@\n}catch(e){return{reader:false,unavailable:true}}})()))",
                         library, toggle];
    [page evaluate:script
        completion:^(NSString *json) {
          id value = json ? Parse(json) : nil;
          if ([value isKindOfClass:NSString.class])
            value = Parse(value);
          [self reply:rid
               result:[value isKindOfClass:NSDictionary.class] ? value : @{@"reader" : @NO, @"unavailable" : @YES}
                error:nil];
        }];
    return;
  }
  if ([action isEqual:@"summarize"]) {
    NSString *helper = [NSBundle.mainBundle.executablePath.stringByDeletingLastPathComponent
        stringByAppendingPathComponent:@"wing-summarize"];
    if (![NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){26, 0, 0}] ||
        ![NSFileManager.defaultManager isExecutableFileAtPath:helper]) {
      [self reply:rid result:nil error:@"Page summaries need macOS 26 with Apple Intelligence."];
      return;
    }
    if (![page.url hasPrefix:@"http"]) {
      [self reply:rid result:nil error:@"Open a web page to summarize it."];
      return;
    }
    NSString *library = [NSString
        stringWithContentsOfFile:[[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"reader"]
                                     stringByAppendingPathComponent:@"Readability.js"]
                        encoding:NSUTF8StringEncoding
                           error:nil] ?: @"";
    // Readability finds the article on a copy of the page; the page itself is untouched.
    NSString *script = [NSString
        stringWithFormat:@"post('result',JSON.stringify((()=>{let t='';try{%@\n"
                         @"t=new Readability(document.cloneNode(true)).parse()?.textContent||''}catch(e){}"
                         @"t=(t.trim().length>200?t:document.body?.innerText||'').replace(/\\s+/g,' ').trim();"
                         @"return{title:document.title,text:t.slice(0,20000)}})()))",
                         library];
    NSString *title = page.title ?: @"";
    [page evaluate:script
        completion:^(NSString *json) {
          id value = json ? Parse(json) : nil;
          if ([value isKindOfClass:NSString.class])
            value = Parse(value);
          NSString *text = [value isKindOfClass:NSDictionary.class] ? value[@"text"] : nil;
          if (![text isKindOfClass:NSString.class] || text.length < 80) {
            [self reply:rid result:nil error:@"There isn't enough text on this page to summarize."];
            return;
          }
          dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            NSTask *task = [NSTask new];
            task.executableURL = [NSURL fileURLWithPath:helper];
            NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe], *errors = [NSPipe pipe];
            task.standardInput = input;
            task.standardOutput = output;
            task.standardError = errors;
            NSError *error;
            BOOL launched = [task launchAndReturnError:&error];
            if (launched) {
              [input.fileHandleForWriting writeData:[text dataUsingEncoding:NSUTF8StringEncoding]];
              [input.fileHandleForWriting closeFile];
            }
            NSData *out = launched ? [output.fileHandleForReading readDataToEndOfFile] : nil;
            NSData *err = launched ? [errors.fileHandleForReading readDataToEndOfFile] : nil;
            if (launched) [task waitUntilExit];
            NSString *summary = out ? [[NSString alloc] initWithData:out encoding:NSUTF8StringEncoding] : nil;
            NSString *problem = err.length ? [[NSString alloc] initWithData:err encoding:NSUTF8StringEncoding] : nil;
            BOOL ok = launched && task.terminationStatus == 0 && summary.length;
            dispatch_async(dispatch_get_main_queue(), ^{
              if (ok)
                [self reply:rid
                     result:@{@"summary" : [summary stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet],
                              @"title" : title}
                      error:nil];
              else
                [self reply:rid result:nil error:problem.length ? problem : @"The page couldn't be summarized."];
            });
          });
        }];
    return;
  }
  if ([action isEqual:@"media-control"]) {
    // Reports the page's media; "toggle" also pauses whatever is playing or resumes
    // the media that was paused last. evaluate: completes when the script posts.
    NSString *op = data[@"op"];
    if (![@[ @"state", @"toggle", @"back", @"ahead" ] containsObject:op ?: @""]) op = @"state";
    [page evaluate:[NSString stringWithFormat:
                       @"post('result',JSON.stringify((()=>{const op='%@',m=[...document.querySelectorAll('video,audio')];"
                       @"const c=m.find(e=>!e.paused&&!e.ended)||m.find(e=>e.currentTime>0&&!e.ended)||m[0];"
                       @"if(!c)return{playing:false,none:true};"
                       @"if(op==='toggle'){if(c.paused)c.play().catch(()=>{});else c.pause()}"
                       @"if(op==='back')c.currentTime=Math.max(0,c.currentTime-10);"
                       @"if(op==='ahead')c.currentTime+=10;"
                       @"const d=navigator.mediaSession?.metadata;"
                       @"return{playing:!c.paused&&!c.ended,video:c.tagName==='VIDEO'&&c.videoWidth>0,"
                       @"time:c.currentTime,duration:c.duration,title:d?.title||'',artist:d?.artist||'',"
                       @"artwork:d?.artwork?.at(-1)?.src||''}})()))",
                       op]
        completion:^(NSString *json) {
          id value = json ? Parse(json) : nil;
          if ([value isKindOfClass:NSString.class])
            value = Parse(value);
          [self reply:rid
               result:[value isKindOfClass:NSDictionary.class] ? value : @{@"playing" : @NO, @"none" : @YES}
                error:nil];
        }];
    return;
  }
  if ([action isEqual:@"stop-sharing"]) {
    BOOL stopped = [page stopCapture];
    [self reply:rid result:@{@"ok":@(stopped)} error:stopped ? nil : @"This page has no active capture to stop."];
    return;
  }
  if ([@[@"capture-page", @"capture-full-page", @"capture-preview"] containsObject:action]) {
    CapturePage(page, [action isEqual:@"capture-full-page"], ^(NSData *body, NSString *error) {
      if (error) { [self reply:rid result:nil error:error]; return; }
      if ([action isEqual:@"capture-preview"]) {
        [self reply:rid result:@{@"png":[body base64EncodedStringWithOptions:0]} error:nil];
      } else if ([data[@"destination"] isEqual:@"clipboard"]) {
        [NSPasteboard.generalPasteboard clearContents];
        BOOL copied = [NSPasteboard.generalPasteboard setData:body forType:NSPasteboardTypePNG];
        [self reply:rid result:@{@"ok":@(copied)} error:copied ? nil : @"The image could not be copied."];
      } else if (getenv("WING_CHROMIUM_TEST_SCRIPT") && [data[@"inspectCapture"] boolValue]) {
        NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:body];
        [self reply:rid result:@{@"width":@(bitmap.pixelsWide), @"height":@(bitmap.pixelsHigh)} error:nil];
      } else [self saveData:body name:@"Wing-page.png" reply:rid];
    });
    return;
  }
  if ([@[ @"save-pdf", @"save-page" ] containsObject:action]) {
    NSString *method = [action isEqual:@"save-pdf"] ? @"Page.printToPDF"
                                                      : @"Page.captureSnapshot";
    NSDictionary *params =
        [action isEqual:@"save-pdf"]   ? @{@"printBackground" : @YES}
                                         : @{@"format" : @"mhtml"};
    [page
        devToolsCall:method
              params:params
             timeout:0
          completion:^(NSDictionary *result, NSString *error) {
            if (error || ![result[@"data"] isKindOfClass:NSString.class]) {
              [self reply:rid result:nil error:error ?: @"Page export failed."];
              return;
            }
            NSData *body =
                [action isEqual:@"save-page"]
                    ? [result[@"data"] dataUsingEncoding:NSUTF8StringEncoding]
                    : [[NSData alloc]
                          initWithBase64EncodedString:result[@"data"]
                                              options:0];
            NSString *extension = [action isEqual:@"save-pdf"]   ? @"pdf"
                                                                   : @"mhtml";
            [self
                saveData:body
                    name:[NSString stringWithFormat:@"Wing-page.%@", extension]
                   reply:rid];
          }];
    return;
  }
  if ([action isEqual:@"extension-action"]) {
    NSString *extensionId = data[@"extensionId"];
    if (![extensionId isKindOfClass:NSString.class] ||
        extensionId.length != 32) {
      [self reply:rid result:nil error:@"Invalid extension action."];
      return;
    }
    NSString *kind = [page executeExtensionAction:extensionId];
    if ([kind isEqual:@"popup"] && ![self showExtensionPopup:extensionId
                                                         tab:page]) {
      [self reply:rid result:nil error:@"The extension popup could not open."];
      return;
    }
    if ([kind isEqual:@"sidePanel"] && ![self showExtensionSidebar:extensionId tab:page]) {
      [self reply:rid result:nil error:@"The extension side panel could not open."];
      return;
    }
  } else if ([action isEqual:@"back"])
    [page goBack];
  else if ([action isEqual:@"forward"])
    [page goForward];
  else if ([action isEqual:@"reload"] || [action isEqual:@"dev-reload"]) {
    NSString *identity = [self identityForTab:page];
    if (identity && _crashedTabs[identity]) {
      [_crashedTabs removeObjectForKey:identity];
      [self pageChanged:page];
    }
    if ([action isEqual:@"dev-reload"])
      [page reloadIgnoringCache];
    else
      [page reload];
  }
  else if ([action isEqual:@"stop"])
    [page stop];
  else if ([action isEqual:@"fill-login"]) {
    if (![page.url hasPrefix:@"https://"]) {
      [self reply:rid result:nil error:@"Open an HTTPS sign-in page first."];
      return;
    }
    BOOL shown = [page showAutofillSuggestions:YES];
    [self reply:rid
         result:@{@"ok" : @(shown)}
          error:shown ? nil : @"Select a sign-in field to show saved logins."];
    return;
  } else if ([action isEqual:@"focus"])
    [page focus];
  else if ([action isEqual:@"dev-source"]) {
    if (![page executeChromeCommand:35002]) {
      [self reply:rid result:nil error:@"The page source could not open."];
      return;
    }
  } else if ([action isEqual:@"dev-cdp"]) {
    [self runDevCalls:data[@"calls"] index:0 page:page reload:[data[@"reload"] boolValue] reply:rid];
    return;
  }
  else if ([action isEqual:@"devtools"]) {
    if ([data[@"close"] boolValue])
      [page closeDevTools];
    else
      [page showDevTools];
  } else if ([action isEqual:@"zoom"]) {
    if ([data[@"reset"] boolValue])
      page.zoomFactor = 1;
    else
      [page zoomStep:[data[@"delta"] intValue] > 0 ? 1 : -1];
  } else if ([action isEqual:@"print-page"]) {
    if (![page executeChromeCommand:35003]) {
      [self reply:rid result:nil error:@"Printing could not start."];
      return;
    }
  } else if ([action isEqual:@"mute"])
    page.muted = !page.muted;
  else if ([action isEqual:@"find"]) {
    if ([data[@"text"] length])
      [page find:data[@"text"]
          forward:data[@"forward"] ? [data[@"forward"] boolValue] : YES];
    else
      [page stopFinding];
  } else {
    [self reply:rid result:nil error:@"Native operation is not supported yet."];
    return;
  }
  [self reply:rid result:@{@"ok" : @YES} error:nil];
}
- (BOOL)engineIsReservedKey:(NSString *)key
               unshiftedKey:(NSString *)unshiftedKey
                  modifiers:(NSEventModifierFlags)modifiers {
  if (!(modifiers & NSEventModifierFlagCommand) ||
      (modifiers & NSEventModifierFlagControl))
    return NO;
  NSString *plain = unshiftedKey.lowercaseString;
  if (modifiers & NSEventModifierFlagOption)
    return [@[ @"i", @"r", @"\uF702", @"\uF703" ] containsObject:plain];
  if (modifiers & NSEventModifierFlagShift)
    return [@[ @"t", @"r", @"2", @"=", @"+", @"j" ] containsObject:plain];
  return [@[
    @"t", @"l", @"w", @"r", @"f", @"s", @"[", @"]", @",", @"y", @"d",
    @"=", @"+", @"-", @"0"
  ] containsObject:plain];
}
- (BOOL)engineIsReservedKeyEvent:(NSEvent *)event {
  return event.type == NSEventTypeKeyDown &&
         [self engineIsReservedKey:event.characters
                      unshiftedKey:[event charactersByApplyingModifiers:0]
                         modifiers:event.modifierFlags];
}
- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  if (event.type == NSEventTypeKeyDown && event.keyCode == 48 &&
      (event.modifierFlags & NSEventModifierFlagControl)) {
    [self send:@"action"
          data:@{
            @"name" : @"recent-tabs-preview",
            @"args" : @{
              @"direction" : (event.modifierFlags & NSEventModifierFlagShift)
                  ? @(-1)
                  : @1
            }
          }];
    [_shell focus];
    return YES;
  }
  if (event.type == NSEventTypeKeyDown && event.keyCode == 53) {
    // Shell modals own Escape; page-focused Escape dismisses the Peek itself.
    if (window != _uiWindow)
      for (NSDictionary *record in _lastSync[@"workspace"][@"tabs"])
        if ([record[@"transient"] boolValue]) {
          [self send:@"action" data:@{@"name" : @"close-peek"}];
          return YES;
        }
    [self send:@"action" data:@{@"name" : @"recent-tabs-cancel"}];
    return NO;
  }
  if (![self engineIsReservedKeyEvent:event])
    return NO;
  NSString *key = [event charactersByApplyingModifiers:0].lowercaseString;
  BOOL shift = (event.modifierFlags & NSEventModifierFlagShift) != 0;
  if (event.modifierFlags & NSEventModifierFlagOption) {
    if ([key isEqual:@"i"])
      [self send:@"action" data:@{@"name" : @"devtools"}];
    else if ([key isEqual:@"r"])
      [self send:@"command" data:@{@"type" : @"reader"}];
    else
      [self send:@"action"
            data:@{
              @"name" : @"swipe-profile",
              @"args" : @{@"direction" : [key isEqual:@"\uF702"] ? @(-1) : @1}
            }];
  } else if ([key isEqual:@","] || [key isEqual:@"y"] || [key isEqual:@"j"] ||
             [key isEqual:@"2"]) {
    NSString *type = [key isEqual:@","]   ? @"settings"
                     : [key isEqual:@"2"] ? @"split-picker"
                                          : @"library";
    [self send:@"command"
          data:@{
            @"type" : type,
            @"tab" : [key isEqual:@"j"] ? @"downloads" : @"history"
          }];
    [_shell focus];
  } else if ([@[ @"=", @"+", @"-", @"0" ] containsObject:key]) {
    [self send:@"action"
          data:@{
            @"name" : @"zoom",
            @"args" : @{
              @"reset" : @([key isEqual:@"0"]),
              @"delta" : [key isEqual:@"-"] ? @(-1) : @1
            }
          }];
  } else if ([key isEqual:@"r"] && shift) {
    [self send:@"action" data:@{@"name" : @"dev-reload"}];
  } else if ([key isEqual:@"t"] && shift) {
    [self send:@"action" data:@{@"name" : @"restore"}];
  } else if ([key isEqual:@"t"] || [key isEqual:@"l"]) {
    [self send:@"command"
          data:@{
            @"type" : @"palette",
            @"mode" : [key isEqual:@"t"] ? @"new" : @"navigate"
          }];
    [_shell focus];
  } else if ([key isEqual:@"f"]) {
    [self send:@"command" data:@{@"type" : @"find"}];
    [_shell focus];
  } else {
    NSDictionary *actions = @{
      @"w" : @"close-tab",
      @"d" : @"pin",
      @"r" : @"reload",
      @"s" : @"sidebar",
      @"[" : @"back",
      @"]" : @"forward"
    };
    [self send:@"action" data:@{@"name" : actions[key]}];
  }
  return YES;
}
@end
static BOOL AnotherCopyIsRunning(NSString *root) {
  NSString *lock = [NSFileManager.defaultManager
      destinationOfSymbolicLinkAtPath:[root stringByAppendingPathComponent:
                                                @"SingletonLock"]
                                error:nil];
  return lock &&
         kill([lock componentsSeparatedByString:@"-"].lastObject.intValue, 0) == 0;
}
// Runs before the engine starts: the engine reloads every profile it still
// knows about, which would recreate a deleted folder.
static void PurgeDeletedProfiles(NSString *root) {
  NSFileManager *files = NSFileManager.defaultManager;
  NSString *queuePath =
      [root stringByAppendingPathComponent:@"wing-deleted-profiles.json"];
  NSData *saved = [NSData dataWithContentsOfFile:queuePath];
  NSArray *queued = saved ? [NSJSONSerialization JSONObjectWithData:saved
                                                            options:0
                                                              error:nil]
                          : nil;
  if (![queued isKindOfClass:NSArray.class] || !queued.count)
    return;
  // Another running copy still has these profiles open.
  if (AnotherCopyIsRunning(root))
    return;
  NSData *body = [NSData
      dataWithContentsOfFile:[root stringByAppendingPathComponent:
                                       @"wing-workspace.json"]];
  NSDictionary *workspace =
      body ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil]
           : nil;
  if (![workspace isKindOfClass:NSDictionary.class] ||
      ![workspace[@"profiles"] isKindOfClass:NSArray.class] ||
      ![workspace[@"spaces"] isKindOfClass:NSArray.class])
    return;
  NSMutableSet *live =
      [NSMutableSet setWithArray:[workspace[@"profiles"] valueForKey:@"id"]];
  [live addObjectsFromArray:[workspace[@"spaces"] valueForKey:@"profileId"]];
  // A throwaway Space is still listed until the shell drops it after this launch.
  for (NSDictionary *space in workspace[@"spaces"])
    if ([space[@"throwaway"] boolValue])
      [live removeObject:space[@"profileId"]];
  NSString *statePath = [root stringByAppendingPathComponent:@"Local State"];
  NSData *stateBody = [NSData dataWithContentsOfFile:statePath];
  NSMutableDictionary *state =
      stateBody ? [NSJSONSerialization
                      JSONObjectWithData:stateBody
                                 options:NSJSONReadingMutableContainers
                                   error:nil]
                : nil;
  NSMutableDictionary *known =
      [state isKindOfClass:NSDictionary.class] ? state[@"profile"][@"info_cache"]
                                               : nil;
  if (![known isKindOfClass:NSMutableDictionary.class])
    known = nil;
  NSMutableArray *remaining = [NSMutableArray new];
  for (NSString *identity in queued) {
    if (!Identifier(identity) || [identity isEqual:@"default"] ||
        [identity isEqual:@"work"] || [live containsObject:identity])
      continue;
    NSString *name = [@"Wing-" stringByAppendingString:identity];
    NSString *path = [root stringByAppendingPathComponent:name];
    if ([files fileExistsAtPath:path] &&
        ![files removeItemAtPath:path error:nil]) {
      [remaining addObject:identity];
      continue;
    }
    [known removeObjectForKey:name];
    // The engine reopens its last-used profile at launch.
    if ([state[@"profile"][@"last_used"] isEqual:name])
      [state[@"profile"] removeObjectForKey:@"last_used"];
    id active = state[@"profile"][@"last_active_profiles"];
    if ([active isKindOfClass:NSMutableArray.class])
      [active removeObject:name];
  }
  if (known) {
    NSData *updated = [NSJSONSerialization dataWithJSONObject:state
                                                      options:0
                                                        error:nil];
    if (updated)
      SaveWorkspace(updated, statePath);
  }
  NSData *rest = [NSJSONSerialization dataWithJSONObject:remaining
                                                 options:0
                                                   error:nil];
  if (rest)
    SaveWorkspace(rest, queuePath);
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSNumber *qualification = [NSBundle.mainBundle objectForInfoDictionaryKey:@"WingQualificationOnly"];
    if (!qualification) {
      fprintf(stderr, "Missing build mode; rebuild the application.\n");
      return 64;
    }
    NSString *directory;
    if (qualification.boolValue) {
      const char *testDirectory = getenv("WING_CHROMIUM_TEST_PROFILE");
      if (!testDirectory || testDirectory[0] != '/') {
        fprintf(stderr, "Preview requires an isolated WING_CHROMIUM_TEST_PROFILE.\n");
        return 64;
      }
      directory = @(testDirectory);
    } else {
      NSDictionary *provenance = Parse([NSString stringWithContentsOfFile:
          [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"engine-provenance.json"]
          encoding:NSUTF8StringEncoding error:nil]);
      if (![provenance[@"kind"] isEqual:@"wing-source"]) {
        fprintf(stderr, "Persistent profiles require the Wing source engine.\n");
        return 64;
      }
      // Production never enables test bridges, fixture import roots or mock credentials.
      for (const char *name : {"WING_CHROMIUM_TEST_PROFILE", "WING_CHROMIUM_TEST_SCRIPT",
                              "WING_CHROMIUM_TEST_REPORT", "WING_CHROMIUM_TEST_EXTENSION",
                              "WING_IMPORT_TEST_BASE", "WING_IMPORT_TEST_KEY"}) unsetenv(name);
      NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory
                                                            inDomains:NSUserDomainMask].firstObject;
      directory = [[support URLByAppendingPathComponent:@"Wing/Chromium" isDirectory:YES] path];
    }
    NSError *error;
    if (![NSFileManager.defaultManager createDirectoryAtPath:directory
                                withIntermediateDirectories:YES
                                                 attributes:@{NSFilePosixPermissions : @0700}
                                                      error:&error]) {
      fprintf(stderr, "Cannot create browser profile directory: %s\n", error.localizedDescription.UTF8String);
      return 73;
    }
    setenv("WING_PROFILE_ROOT", directory.UTF8String, 1);
    PurgeDeletedProfiles(directory);
    // A marker left behind means the last run never reached a normal exit. A
    // second launch only hands off to the running copy, so it leaves it alone.
    if (!AnotherCopyIsRunning(directory)) {
      gRunningMarker = [directory stringByAppendingPathComponent:@"wing-running"]
                           .fileSystemRepresentation;
      gUncleanExit = access(gRunningMarker.c_str(), F_OK) == 0;
      close(open(gRunningMarker.c_str(), O_CREAT | O_WRONLY, 0600));
      atexit([] { unlink(gRunningMarker.c_str()); });
    }
    std::string profile = std::string("--user-data-dir=") + directory.UTF8String;
    std::vector<const char *> args;
    args.push_back(argv[0]);
    // The staged app owns its profile and credential settings. Test runners alone
    // may provide Chromium test flags; normal launches accept web URLs via GURL.
    if (qualification.boolValue)
      args.insert(args.end(), argv + 1, argv + argc);
    else
      for (int i = 1; i < argc; i++)
        if (!strncmp(argv[i], "--remote-debugging-port=", 24))
          args.push_back(argv[i]);
    args.push_back(profile.c_str());
    // Chromium 156 otherwise shows a tab's renderer only once the tab takes focus,
    // and Wing activates page tabs without focusing them, leaving them blank.
    args.push_back("--disable-features=RemoveEnsureRFHVisibilityConsistent");
    if (qualification.boolValue) args.push_back("--use-mock-keychain");
    static WingChromiumHost *host = [WingChromiumHost new];
    return [ArdiaCoreEngine runWithArgc:(int)args.size()
                                   argv:args.data()
                               delegate:host];
  }
}

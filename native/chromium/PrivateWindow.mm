#import "PrivateWindow.h"
#import "ArdiaCore.h"

static NSString *const kTabbing = @"WingPrivate";
static NSMutableArray *gWindows;
static ArdiaCoreProfile *gProfile;
static NSString *gSearch = @"https://www.google.com/search?q=";

@interface WingPrivateWindow () <ArdiaCoreWindowDelegate, ArdiaCoreTabDelegate,
                                 NSToolbarDelegate, NSTextFieldDelegate>
@end

@implementation WingPrivateWindow {
  ArdiaCoreWindow *_core;
  ArdiaCoreTab *_tab;
  NSTextField *_address;
  NSToolbarItem *_back, *_forward, *_reload;
  NSView *_welcome;
  BOOL _closing;
  BOOL _opening;
}

#pragma mark Opening

+ (void)openFromProfile:(ArdiaCoreProfile *)profile
                    url:(NSString *)url
                 search:(NSString *)searchPrefix {
  if (searchPrefix.length) gSearch = searchPrefix;
  if (gProfile && !gProfile.destroyed) {
    [self openURL:url tab:nil parent:nil];
    return;
  }
  [ArdiaCoreEngine.sharedEngine
      offTheRecordProfileFor:profile
                  completion:^(ArdiaCoreProfile *offTheRecord, NSString *error) {
                    if (!offTheRecord) {
                      NSAlert *alert = [NSAlert new];
                      alert.messageText = @"A private window couldn’t be opened.";
                      alert.informativeText = error ?: @"";
                      [alert runModal];
                      return;
                    }
                    gProfile = offTheRecord;
                    [self openURL:url tab:nil parent:nil];
                  }];
}

+ (instancetype)openURL:(NSString *)url
                    tab:(ArdiaCoreTab *)tab
                 parent:(WingPrivateWindow *)parent {
  WingPrivateWindow *window = [self new];
  gWindows = gWindows ?: [NSMutableArray new];
  [gWindows addObject:window];
  [window openURL:url tab:tab parent:parent];
  return window;
}

+ (WingPrivateWindow *)frontmost {
  for (NSWindow *window in NSApp.orderedWindows)
    for (WingPrivateWindow *candidate in gWindows)
      if (candidate->_core.window == window) return candidate;
  return nil;
}

// The private window in front of every other Wing window, if any. Key status
// alone is not enough: no window is key while Wing is in the background.
+ (WingPrivateWindow *)keyPrivateWindow {
  if (NSApp.keyWindow) {
    for (WingPrivateWindow *candidate in gWindows)
      if (candidate->_core.window == NSApp.keyWindow) return candidate;
    return nil;
  }
  for (NSWindow *window in NSApp.orderedWindows) {
    if (!window.visible || [window isKindOfClass:NSPanel.class] || !window.canBecomeMainWindow)
      continue;
    for (WingPrivateWindow *candidate in gWindows)
      if (candidate->_core.window == window) return candidate;
    return nil;
  }
  return nil;
}

+ (ArdiaCoreWindow *)engineWindowForProfile:(ArdiaCoreProfile *)profile {
  if (!profile.offTheRecord || profile != gProfile) return nil;
  return [self frontmost]->_core;
}

- (void)openURL:(NSString *)url tab:(ArdiaCoreTab *)adopted parent:(WingPrivateWindow *)parent {
  NSRect frame = parent ? parent->_core.window.frame : NSMakeRect(0, 0, 1180, 780);
  _core = [[ArdiaCoreWindow alloc] initWithContentRect:frame];
  _core.delegate = self;
  [_core prepareProfile:gProfile];
  _core.activeProfile = gProfile;
  _opening = YES;
  if (adopted) {
    [_core adoptTab:adopted];
    _tab = adopted;
  } else
    _tab = [_core openTab:url.length ? url : @"about:blank" profile:gProfile foreground:YES];
  _opening = NO;
  _tab.delegate = self;

  NSWindow *window = _core.window;
  window.title = @"Private Browsing";
  window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  window.backgroundColor = [NSColor colorWithWhite:0.12 alpha:1];
  window.tabbingIdentifier = kTabbing;
  window.tabbingMode = NSWindowTabbingModePreferred;
  window.minSize = NSMakeSize(520, 360);
  window.toolbarStyle = NSWindowToolbarStyleUnified;
  window.titleVisibility = NSWindowTitleHidden;
  NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"WingPrivateToolbar"];
  toolbar.delegate = self;
  toolbar.displayMode = NSToolbarDisplayModeIconOnly;
  toolbar.centeredItemIdentifier = @"address";
  window.toolbar = toolbar;

  NSView *host = _core.hostView;
  _tab.view.frame = host.bounds;
  _tab.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [host addSubview:_tab.view];
  [self buildWelcome];
  [_tab noteShownByHost:YES];
  [_core activateTab:_tab];

  if (parent) {
    [parent->_core.window addTabbedWindow:window ordered:NSWindowAbove];
  } else if (![NSApp.orderedWindows containsObject:window])
    [window center];
  [window makeKeyAndOrderFront:nil];
  [self refresh];
  if (!url.length && !adopted) [window makeFirstResponder:_address];
}

// Shown over a blank page, like Safari's private start page.
- (void)buildWelcome {
  NSImageView *icon = [NSImageView
      imageViewWithImage:[NSImage imageWithSystemSymbolName:@"hand.raised.fill"
                                   accessibilityDescription:nil]];
  icon.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:34
                                                                             weight:NSFontWeightRegular];
  icon.contentTintColor = NSColor.secondaryLabelColor;
  NSTextField *title = [NSTextField labelWithString:@"Private Browsing"];
  title.font = [NSFont systemFontOfSize:22 weight:NSFontWeightSemibold];
  NSTextField *body = [NSTextField
      wrappingLabelWithString:@"Wing won’t remember the pages you visit, your search history or "
                              @"what you fill in forms after you close every private window. "
                              @"Files you download are kept."];
  body.alignment = NSTextAlignmentCenter;
  body.textColor = NSColor.secondaryLabelColor;
  body.font = [NSFont systemFontOfSize:13];
  body.preferredMaxLayoutWidth = 420;
  NSStackView *stack = [NSStackView stackViewWithViews:@[ icon, title, body ]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.spacing = 10;
  [stack setCustomSpacing:16 afterView:icon];

  NSView *cover = [[NSView alloc] initWithFrame:_core.hostView.bounds];
  cover.wantsLayer = YES;
  cover.layer.backgroundColor = [NSColor colorWithWhite:0.12 alpha:1].CGColor;
  cover.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [cover addSubview:stack];
  [stack.centerXAnchor constraintEqualToAnchor:cover.centerXAnchor].active = YES;
  [stack.centerYAnchor constraintEqualToAnchor:cover.centerYAnchor constant:-30].active = YES;
  [stack.widthAnchor constraintLessThanOrEqualToConstant:440].active = YES;
  _welcome = cover;
  [_core.hostView addSubview:cover];
}

#pragma mark Toolbar

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  return @[ @"back", @"forward", NSToolbarFlexibleSpaceItemIdentifier, @"address",
            NSToolbarFlexibleSpaceItemIdentifier, @"reload", @"new-tab" ];
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}
- (NSToolbarItem *)button:(NSString *)identifier
                   symbol:(NSString *)symbol
                    label:(NSString *)label
                   action:(SEL)action {
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
  item.image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:label];
  item.label = label;
  item.toolTip = label;
  item.bordered = YES;
  item.target = self;
  item.action = action;
  return item;
}
- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar
        itemForItemIdentifier:(NSToolbarItemIdentifier)identifier
    willBeInsertedIntoToolbar:(BOOL)flag {
  if ([identifier isEqual:@"back"])
    return _back = [self button:identifier symbol:@"chevron.left" label:@"Back" action:@selector(goBack:)];
  if ([identifier isEqual:@"forward"])
    return _forward = [self button:identifier symbol:@"chevron.right" label:@"Forward" action:@selector(goForward:)];
  if ([identifier isEqual:@"reload"])
    return _reload = [self button:identifier symbol:@"arrow.clockwise" label:@"Reload" action:@selector(reloadOrStop:)];
  if ([identifier isEqual:@"new-tab"])
    return [self button:identifier symbol:@"plus" label:@"New Private Tab" action:@selector(newTab:)];
  if (![identifier isEqual:@"address"]) return nil;
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
  _address = [NSTextField new];
  _address.placeholderString = @"Search or enter website name";
  _address.bezelStyle = NSTextFieldRoundedBezel;
  _address.alignment = NSTextAlignmentCenter;
  _address.font = [NSFont systemFontOfSize:13];
  _address.cell.scrollable = YES;
  _address.cell.usesSingleLineMode = YES;
  _address.target = self;
  _address.action = @selector(go:);
  _address.delegate = self;
  [_address.widthAnchor constraintGreaterThanOrEqualToConstant:260].active = YES;
  [_address.widthAnchor constraintLessThanOrEqualToConstant:640].active = YES;
  NSLayoutConstraint *preferred = [_address.widthAnchor constraintEqualToConstant:520];
  preferred.priority = NSLayoutPriorityDefaultLow;
  preferred.active = YES;
  item.view = _address;
  item.label = @"Address";
  return item;
}

- (void)controlTextDidBeginEditing:(NSNotification *)notification {
  _address.alignment = NSTextAlignmentLeft;
  _address.stringValue = [self visibleURL];
}
- (void)controlTextDidEndEditing:(NSNotification *)notification {
  _address.alignment = NSTextAlignmentCenter;
  [self refresh];
}

#pragma mark Actions

- (NSString *)visibleURL {
  NSString *url = _tab.url ?: @"";
  return [url isEqual:@"about:blank"] ? @"" : url;
}

- (NSString *)resolve:(NSString *)input {
  NSString *value = [input stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSURL *url = [NSURL URLWithString:value];
  if ([@[ @"http", @"https" ] containsObject:url.scheme.lowercaseString] && url.host.length)
    return url.absoluteString;
  NSRegularExpression *host = [NSRegularExpression
      regularExpressionWithPattern:@"^(localhost|[\\w-]+(\\.[\\w-]+)+)(:\\d+)?(/\\S*)?$"
                           options:NSRegularExpressionCaseInsensitive
                             error:nil];
  if (![value containsString:@" "] &&
      [host numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)])
    return [@"https://" stringByAppendingString:value];
  NSString *query = [value stringByAddingPercentEncodingWithAllowedCharacters:
                               NSCharacterSet.URLQueryAllowedCharacterSet];
  query = [query stringByReplacingOccurrencesOfString:@"&" withString:@"%26"];
  query = [query stringByReplacingOccurrencesOfString:@"+" withString:@"%2B"];
  return [gSearch stringByAppendingString:query ?: @""];
}

- (void)go:(id)sender {
  if (!_address.stringValue.length) return;
  [_tab loadURL:[self resolve:_address.stringValue] userInitiated:YES];
  [_core.window makeFirstResponder:nil];
  [_tab focus];
}
- (void)goBack:(id)sender { [_tab goBack]; }
- (void)goForward:(id)sender { [_tab goForward]; }
- (void)reloadOrStop:(id)sender {
  _tab.loading ? [_tab stop] : [_tab reload];
}
- (void)newTab:(id)sender {
  [WingPrivateWindow openURL:nil tab:nil parent:self];
}
- (void)focusAddress {
  [_core.window makeFirstResponder:_address];
  [_address selectText:nil];
}

+ (BOOL)performMenuAction:(NSString *)name args:(NSDictionary *)args {
  WingPrivateWindow *window = [self keyPrivateWindow];
  if (!window) return NO;
  return [window perform:name args:args];
}

- (BOOL)perform:(NSString *)name args:(NSDictionary *)args {
  if ([name isEqual:@"new-tab"] || [name isEqual:@"palette-new"])
    [self newTab:nil];
  else if ([name isEqual:@"palette-navigate"])
    [self focusAddress];
  else if ([name isEqual:@"close-tab"])
    [_core.window performClose:nil];
  else if ([name isEqual:@"reload"])
    [_tab reload];
  else if ([name isEqual:@"stop"])
    [_tab stop];
  else if ([name isEqual:@"back"])
    [_tab goBack];
  else if ([name isEqual:@"forward"])
    [_tab goForward];
  else if ([name isEqual:@"zoom"]) {
    if ([args[@"reset"] boolValue])
      _tab.zoomFactor = 1;
    else
      [_tab zoomStep:[args[@"delta"] intValue] < 0 ? -1 : 1];
  } else if ([name isEqual:@"cycle-tab"]) {
    [_core.window performSelector:[args[@"direction"] intValue] < 0 ? @selector(selectPreviousTab:)
                                                                       : @selector(selectNextTab:)
                       withObject:nil];
  } else
    return NO;
  return YES;
}

#pragma mark State

- (void)refresh {
  if (_closing) return;
  BOOL blank = [self visibleURL].length == 0;
  _welcome.hidden = !blank;
  NSString *title = _tab.title.length && !blank ? _tab.title : @"Private Browsing";
  _core.window.title = title;
  _core.window.tab.title = title;
  _back.enabled = _tab.canGoBack;
  _forward.enabled = _tab.canGoForward;
  _reload.image = [NSImage imageWithSystemSymbolName:_tab.loading ? @"xmark" : @"arrow.clockwise"
                            accessibilityDescription:_tab.loading ? @"Stop" : @"Reload"];
  if (_address.currentEditor) return;
  NSURL *url = [NSURL URLWithString:[self visibleURL]];
  NSString *host = url.host;
  if ([host hasPrefix:@"www."]) host = [host substringFromIndex:4];
  _address.stringValue = host.length ? host : [self visibleURL];
}
- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeURL:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeNavigationState:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabWillClose:(ArdiaCoreTab *)tab {
  if (tab == _tab && !_closing) [_core.window performClose:nil];
}

#pragma mark Window

- (void)window:(ArdiaCoreWindow *)window
    didInsertTab:(ArdiaCoreTab *)tab
          opener:(ArdiaCoreTab *)opener
     disposition:(NSString *)disposition {
  // openTab: and adoptTab: report their own tab synchronously, before _tab is
  // assigned, so ownership is checked once the current call has finished.
  if (_opening || tab == _tab) return;
  // Links that open a new tab or popup become another private window tab.
  dispatch_async(dispatch_get_main_queue(), ^{
    if (tab.closed || self->_closing) return;
    for (WingPrivateWindow *window in gWindows)
      if (window->_tab == tab) return;
    // A page that keeps opening windows gets its extras closed, not a flood.
    if (gWindows.count >= 60) {
      [tab closeNow];
      return;
    }
    NSWindow *front = self->_core.window;
    [WingPrivateWindow openURL:nil tab:tab parent:self];
    if ([disposition isEqual:@"background_tab"]) [front makeKeyAndOrderFront:nil];
  });
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  if (event.type != NSEventTypeKeyDown) return NO;
  NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (flags != NSEventModifierFlagCommand) return NO;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  NSDictionary *actions = @{
    @"t" : @"new-tab",
    @"l" : @"palette-navigate",
    @"w" : @"close-tab",
    @"r" : @"reload",
    @"[" : @"back",
    @"]" : @"forward"
  };
  return actions[key] && [self perform:actions[key] args:@{}];
}

- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window {
  if (_closing) return YES;
  _closing = YES;
  // Like Safari, closing a tab selects its neighbour rather than another app window.
  NSArray<NSWindow *> *group = _core.window.tabGroup.windows;
  NSUInteger index = [group indexOfObject:_core.window];
  if (group.count > 1 && index != NSNotFound) {
    NSWindow *next = group[index + 1 < group.count ? index + 1 : index - 1];
    dispatch_async(dispatch_get_main_queue(), ^{
      next.tabGroup.selectedWindow = next;
      [next makeKeyAndOrderFront:nil];
    });
  }
  _tab.delegate = nil;
  [_tab closeNow];
  [gWindows removeObject:self];
  if (!gWindows.count && gProfile) {
    // Every private window is gone: drop the profile and everything in it.
    ArdiaCoreProfile *profile = gProfile;
    gProfile = nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      [ArdiaCoreEngine.sharedEngine releaseProfile:profile];
    });
  }
  return YES;
}
@end

#import "WebKitPage.h"
#import <CommonCrypto/CommonDigest.h>
#import <WebKit/WebKit.h>

static NSArray<NSString *> *const kStreamingHosts = @[
  @"netflix.com", @"disneyplus.com", @"max.com", @"hbomax.com", @"primevideo.com",
  @"hulu.com", @"tv.apple.com", @"music.apple.com", @"open.spotify.com", @"peacocktv.com",
  @"paramountplus.com", @"crunchyroll.com", @"hotstar.com"
];

BOOL WingStreamingURL(NSString *url) {
  NSURL *parsed = url ? [NSURL URLWithString:url] : nil;
  if (![parsed.scheme.lowercaseString isEqual:@"https"])
    return NO;
  NSString *host = parsed.host.lowercaseString ?: @"";
  for (NSString *site in kStreamingHosts)
    if ([host isEqual:site] || [host hasSuffix:[@"." stringByAppendingString:site]])
      return YES;
  return NO;
}

// One persistent store per Wing profile, named by a UUID derived from its id so
// it survives restarts; private windows share one store that dies with them.
static WKWebsiteDataStore *StoreFor(NSString *profileId, BOOL ephemeral) {
  static NSMutableDictionary<NSString *, WKWebsiteDataStore *> *ephemeralStores;
  if (ephemeral) {
    if (!ephemeralStores)
      ephemeralStores = [NSMutableDictionary new];
    if (!ephemeralStores[profileId])
      ephemeralStores[profileId] = WKWebsiteDataStore.nonPersistentDataStore;
    return ephemeralStores[profileId];
  }
  NSData *name = [[@"wing-webkit-" stringByAppendingString:profileId] dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(name.bytes, (CC_LONG)name.length, digest);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return [WKWebsiteDataStore dataStoreForIdentifier:[[NSUUID alloc] initWithUUIDBytes:digest]];
}

static NSString *SafariVersion(void) {
  NSDictionary *info = [NSDictionary
      dictionaryWithContentsOfFile:@"/Applications/Safari.app/Contents/Info.plist"];
  NSString *version = info[@"CFBundleShortVersionString"];
  return version.length ? version : @"26.0";
}

static NSArray<NSString *> *const kObserved =
    @[ @"URL", @"title", @"loading", @"canGoBack", @"canGoForward", @"estimatedProgress" ];

@interface WingWebKitPage () <WKNavigationDelegate, WKUIDelegate>
@end

@implementation WingWebKitPage {
  WKWebView *_web;
  NSString *_favicon;
  BOOL _closed;
}

- (instancetype)initWithProfile:(NSString *)profileId ephemeral:(BOOL)ephemeral {
  if ((self = [super init])) {
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = StoreFor(profileId, ephemeral);
    config.applicationNameForUserAgent =
        [NSString stringWithFormat:@"Version/%@ Safari/605.1.15", SafariVersion()];
    config.preferences.elementFullscreenEnabled = YES;
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    _web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600) configuration:config];
    _web.navigationDelegate = self;
    _web.UIDelegate = self;
    _web.allowsBackForwardNavigationGestures = YES;
    _web.allowsMagnification = YES;
    _web.underPageBackgroundColor = NSColor.blackColor;
    for (NSString *key in kObserved)
      [_web addObserver:self forKeyPath:key options:0 context:nil];
  }
  return self;
}

- (NSView *)view {
  return _web;
}
- (NSString *)url {
  return _web.URL.absoluteString ?: @"";
}
- (NSString *)title {
  return _web.title ?: @"";
}
- (NSString *)faviconURL {
  return _favicon ?: @"";
}
- (BOOL)loading {
  return _web.loading;
}
- (BOOL)canGoBack {
  return _web.canGoBack;
}
- (BOOL)canGoForward {
  return _web.canGoForward;
}
- (double)progress {
  return _web.estimatedProgress;
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
  if ([keyPath isEqual:@"URL"])
    _favicon = nil;
  [self changed];
}
- (void)changed {
  if (!_closed && _onChange)
    _onChange();
}

- (void)load:(NSString *)url {
  NSURL *parsed = [NSURL URLWithString:url];
  if (parsed)
    [_web loadRequest:[NSURLRequest requestWithURL:parsed]];
}
- (void)goBack {
  [_web goBack];
}
- (void)goForward {
  [_web goForward];
}
- (void)reload {
  [_web reload];
}
- (void)stop {
  [_web stopLoading];
}
- (void)focus {
  [_web.window makeFirstResponder:_web];
}
- (void)evaluate:(NSString *)script completion:(void (^)(id))completion {
  [_web callAsyncJavaScript:script
                  arguments:nil
                    inFrame:nil
             inContentWorld:WKContentWorld.defaultClientWorld
          completionHandler:^(id value, NSError *error) {
            completion(error ? error.localizedDescription : value);
          }];
}
- (void)close {
  if (_closed)
    return;
  _closed = YES;
  for (NSString *key in kObserved)
    [_web removeObserver:self forKeyPath:key];
  _web.navigationDelegate = nil;
  _web.UIDelegate = nil;
  [_web stopLoading];
  [_web loadHTMLString:@"" baseURL:nil];
  [_web removeFromSuperview];
}
- (void)dealloc {
  [self close];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  [_web evaluateJavaScript:@"(document.querySelector('link[rel~=\"icon\"]')||{}).href||location.origin+'/favicon.ico'"
         completionHandler:^(id value, NSError *error) {
           if ([value isKindOfClass:NSString.class] && [value hasPrefix:@"http"]) {
             self->_favicon = value;
             [self changed];
           }
         }];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  NSString *scheme = action.request.URL.scheme.lowercaseString;
  if (scheme && ![@[ @"http", @"https", @"about", @"blob", @"data" ] containsObject:scheme]) {
    [NSWorkspace.sharedWorkspace openURL:action.request.URL];
    decisionHandler(WKNavigationActionPolicyCancel);
    return;
  }
  decisionHandler(WKNavigationActionPolicyAllow);
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)action
                    windowFeatures:(WKWindowFeatures *)features {
  NSString *url = action.request.URL.absoluteString;
  if (url.length && _onOpen)
    _onOpen(url);
  return nil;
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  [_web reload];
}
@end

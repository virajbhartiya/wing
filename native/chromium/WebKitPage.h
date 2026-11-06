#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
// A page shown by WebKit instead of Chromium. Chromium has no Widevine, so
// streaming sites (Netflix and the like) open here, where FairPlay plays them.
// Each profile keeps its own WebKit cookies and storage.
@interface WingWebKitPage : NSObject
@property(readonly) NSView *view;
@property(readonly, copy) NSString *url;
@property(readonly, copy) NSString *title;
@property(readonly, copy) NSString *faviconURL;
@property(readonly) BOOL loading, canGoBack, canGoForward;
@property(readonly) double progress;
// Title, address, loading or history changed.
@property(nonatomic, copy, nullable) void (^onChange)(void);
// The page asked for a new window or tab.
@property(nonatomic, copy, nullable) void (^onOpen)(NSString *url);
- (instancetype)initWithProfile:(NSString *)profileId ephemeral:(BOOL)ephemeral;
- (void)load:(NSString *)url;
- (void)goBack;
- (void)goForward;
- (void)reload;
- (void)stop;
- (void)focus;
- (void)evaluate:(NSString *)script completion:(void (^)(id _Nullable value))completion;
- (void)close;
@end
// https pages of streaming sites whose video needs DRM.
BOOL WingStreamingURL(NSString *_Nullable url);
NS_ASSUME_NONNULL_END

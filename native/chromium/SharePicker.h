#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
// What a page may share when it calls getDisplayMedia: one of Wing's own tabs,
// another app's window, or a whole screen. Nothing is shared until the person
// picks a source; closing the popover refuses the request.
@interface WingSharePicker : NSObject
// Each source is {id, kind: tab|window|screen, name, detail?, icon?: NSImage}.
- (instancetype)initWithSite:(NSString *)site
                     sources:(NSArray<NSDictionary *> *)sources
                    askAudio:(BOOL)askAudio
                  completion:(void (^)(NSString *_Nullable sourceId, NSString *_Nullable audio))completion;
- (void)showInView:(NSView *)view anchor:(NSRect)anchor edge:(NSRectEdge)edge;
- (void)close;
// Screens and windows other than Wing's need macOS Screen Recording access.
+ (BOOL)canCaptureScreen;
+ (NSArray<NSDictionary *> *)screenAndWindowSources;
@end
NS_ASSUME_NONNULL_END

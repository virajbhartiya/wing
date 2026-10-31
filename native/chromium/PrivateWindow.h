#import <AppKit/AppKit.h>
@class ArdiaCoreProfile;
@class ArdiaCoreWindow;
NS_ASSUME_NONNULL_BEGIN
// Safari-style private browsing: dark windows on an off-the-record profile,
// one page per window, grouped with native macOS window tabs. Nothing is
// written to disk, and closing the last private window discards the profile.
@interface WingPrivateWindow : NSObject
+ (void)openFromProfile:(ArdiaCoreProfile *)profile
                    url:(nullable NSString *)url
                 search:(NSString *)searchPrefix;
// The window the engine should use for popups opened from a private page.
+ (nullable ArdiaCoreWindow *)engineWindowForProfile:(ArdiaCoreProfile *)profile;
// Routes a menu action to the frontmost private window. Returns NO when no
// private window is key or the action has no private-window meaning.
+ (BOOL)performMenuAction:(NSString *)name args:(NSDictionary *)args;
@end
NS_ASSUME_NONNULL_END

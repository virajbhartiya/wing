#import "ArdiaCore.h"
#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
@interface WingExtensionPanel : NSObject
- (BOOL)showURL:(NSString *)url
        browser:(ArdiaCoreWindow *)browser
        profile:(ArdiaCoreProfile *)profile;
- (void)close;
@end
NS_ASSUME_NONNULL_END

#import "ArdiaCore.h"
#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
@interface WingExtensionSidebar : NSObject
@property(nonatomic, copy, nullable) void (^onClose)(void);
@property(readonly, nullable) ArdiaCoreTab *page;
@property(readonly, nullable) NSString *extensionId;
- (BOOL)open:(NSString *)extensionId from:(ArdiaCoreTab *)owner browser:(ArdiaCoreWindow *)browser;
- (void)layoutIn:(NSView *)host frame:(NSRect)frame visible:(BOOL)visible;
- (void)close;
@end
NS_ASSUME_NONNULL_END

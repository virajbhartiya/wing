#import "ArdiaCore.h"
#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
@interface WingDeviceChooser : NSObject
@property(readonly) ArdiaCoreTab *tab;
@property(nonatomic, copy, nullable) void (^onClose)(void);
- (instancetype)initWithTab:(ArdiaCoreTab *)tab window:(NSWindow *)window;
- (void)update:(NSDictionary *)state;
- (void)cancel;
@end
NS_ASSUME_NONNULL_END

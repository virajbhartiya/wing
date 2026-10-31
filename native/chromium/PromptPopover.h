#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
// A site prompt attached to the address field, like Safari's permission and
// password popovers. Buttons are listed left to right; the last is default.
// The completion receives the chosen button index, or -1 when dismissed.
@interface WingPromptPopover : NSObject
+ (instancetype)showInView:(NSView *)view
                    anchor:(NSRect)anchor
                    symbol:(NSString *)symbol
                     title:(NSString *)title
                   message:(nullable NSString *)message
                   buttons:(NSArray<NSString *> *)buttons
                  remember:(nullable NSString *)remember
                completion:(void (^)(NSInteger choice, BOOL remember))completion;
- (void)dismiss;
@end
NS_ASSUME_NONNULL_END

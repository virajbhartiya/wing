#import "ArdiaCore.h"
#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
// The Cast device list for one tab, in a popover under the address bar. The
// engine owns discovery and routes; this only shows its dialog state.
@interface WingCastPicker : NSObject
@property(readonly) ArdiaCoreTab *tab;
@property(nonatomic, copy, nullable) void (^onClose)(void);
@property(readonly, nullable) NSDictionary *state;
- (void)chooseSinkAtIndex:(NSInteger)index;
- (instancetype)initWithTab:(ArdiaCoreTab *)tab view:(NSView *)view anchor:(NSRect)anchor;
- (void)update:(NSDictionary *)state;
- (void)close;
@end
NS_ASSUME_NONNULL_END

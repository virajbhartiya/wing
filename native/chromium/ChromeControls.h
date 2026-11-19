#import <AppKit/AppKit.h>
NS_ASSUME_NONNULL_BEGIN
// Controls drawn like the shell's toolbar, for native windows and overlays.
// Space colors arrive as the shell's CSS hex strings: #rgb, #rrggbb or #rrggbbaa.
NSColor *WingHexColor(id _Nullable value, NSColor *fallback);
// No bezel; a rounded fill on hover and press. Holds one control.
@interface WingChromeControl : NSView
@property(nonatomic, nullable) NSColor *hoverColor, *pressColor;
@property(nonatomic) BOOL pressed;
- (void)paint;
@end
@interface WingChromeButton : NSButton
@end
// The address field sits in a pill filled with the Space's hover color.
@interface WingAddressPill : WingChromeControl
@property(nonatomic, nullable) NSColor *restFill;
@end
NS_ASSUME_NONNULL_END

#import "ChromeControls.h"

// Space colors arrive as the shell's CSS hex strings: #rgb, #rrggbb or #rrggbbaa.
NSColor *WingHexColor(id value, NSColor *fallback) {
  if (![value isKindOfClass:NSString.class] || ![value hasPrefix:@"#"]) return fallback;
  NSString *hex = [value substringFromIndex:1];
  if (hex.length == 3)
    hex = [NSString stringWithFormat:@"%1$@%1$@%2$@%2$@%3$@%3$@", [hex substringWithRange:NSMakeRange(0, 1)],
                                     [hex substringWithRange:NSMakeRange(1, 1)], [hex substringWithRange:NSMakeRange(2, 1)]];
  if (hex.length == 6) hex = [hex stringByAppendingString:@"ff"];
  unsigned rgba = 0;
  if (hex.length != 8 || ![[NSScanner scannerWithString:hex] scanHexInt:&rgba]) return fallback;
  return [NSColor colorWithSRGBRed:((rgba >> 24) & 0xff) / 255.0
                             green:((rgba >> 16) & 0xff) / 255.0
                              blue:((rgba >> 8) & 0xff) / 255.0
                             alpha:(rgba & 0xff) / 255.0];
}

// The shell's toolbar controls: no bezel, a rounded fill on hover and press.
@implementation WingChromeControl {
  NSTrackingArea *_area;
  BOOL _hover;
}
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.cornerRadius = 8;
    self.layer.cornerCurve = @"continuous";
  }
  return self;
}
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_area) [self removeTrackingArea:_area];
  _area = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
             owner:self
          userInfo:nil];
  [self addTrackingArea:_area];
}
- (BOOL)active {
  for (NSView *view in self.subviews)
    if ([view isKindOfClass:NSControl.class] && !((NSControl *)view).enabled) return NO;
  return YES;
}
- (void)paint {
  NSColor *fill = !self.active ? nil : self.pressed ? self.pressColor : _hover ? self.hoverColor : self.restColor;
  self.layer.backgroundColor = fill.CGColor;
}
- (NSColor *)restColor { return nil; }
- (void)setPressed:(BOOL)pressed { _pressed = pressed; [self paint]; }
- (void)setHoverColor:(NSColor *)color { _hoverColor = color; [self paint]; }
- (void)mouseEntered:(NSEvent *)event { _hover = YES; [self paint]; }
- (void)mouseExited:(NSEvent *)event { _hover = NO; [self paint]; }
@end

@implementation WingChromeButton
- (void)mouseDown:(NSEvent *)event {
  WingChromeControl *backing = (WingChromeControl *)self.superview;
  backing.pressed = YES;
  [super mouseDown:event];
  backing.pressed = NO;
}
- (void)setEnabled:(BOOL)enabled {
  super.enabled = enabled;
  self.alphaValue = enabled ? 1 : 0.4;
  [(WingChromeControl *)self.superview paint];
}
@end

// The address field sits in a pill filled with the Space's hover color.
@implementation WingAddressPill
- (NSColor *)restColor { return self.restFill; }
- (void)setRestFill:(NSColor *)color { _restFill = color; [self paint]; }
@end


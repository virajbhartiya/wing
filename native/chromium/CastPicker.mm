#import "CastPicker.h"

// media_router::MediaCastMode bits, in the order Chrome prefers them.
static const int kCastModes[] = {0x1 /* presentation */, 0x8 /* remote playback */,
                                 0x2 /* tab */, 0x4 /* desktop */};

@interface WingCastPicker () <NSPopoverDelegate>
@end

@implementation WingCastPicker {
  NSPopover *_popover;
  NSStackView *_list;
  NSTextField *_header, *_note;
  NSView *_view;
  NSRect _anchor;
  NSArray *_sinks;
  int _identity;
  BOOL _shown, _finished, _searchedLong;
}
@synthesize tab = _tab;
@synthesize state = _state;

- (instancetype)initWithTab:(ArdiaCoreTab *)tab view:(NSView *)view anchor:(NSRect)anchor {
  if ((self = [super init])) {
    _tab = tab;
    _view = view;
    _anchor = anchor;
    _header = [NSTextField labelWithString:@"Cast this tab"];
    _header.font = [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
    _note = [NSTextField wrappingLabelWithString:@""];
    _note.font = [NSFont systemFontOfSize:11];
    _note.textColor = NSColor.secondaryLabelColor;
    _list = [NSStackView stackViewWithViews:@[]];
    _list.orientation = NSUserInterfaceLayoutOrientationVertical;
    _list.alignment = NSLayoutAttributeLeading;
    _list.spacing = 2;
    NSStackView *content = [NSStackView stackViewWithViews:@[ _header, _list, _note ]];
    content.orientation = NSUserInterfaceLayoutOrientationVertical;
    content.alignment = NSLayoutAttributeLeading;
    content.spacing = 10;
    content.edgeInsets = NSEdgeInsetsMake(14, 14, 14, 14);
    [content.widthAnchor constraintEqualToConstant:300].active = YES;
    [_note.widthAnchor constraintEqualToConstant:272].active = YES;
    NSViewController *controller = [NSViewController new];
    controller.view = content;
    _popover = [NSPopover new];
    _popover.behavior = NSPopoverBehaviorTransient;
    _popover.contentViewController = controller;
    _popover.delegate = self;
    // Discovery can take a few seconds; say so honestly once it has.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 6 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      self->_searchedLong = YES;
      [self render];
    });
  }
  return self;
}

- (void)update:(NSDictionary *)state {
  if (_finished)
    return;
  _identity = [state[@"id"] intValue];
  _state = [state copy];
  if (![state[@"open"] boolValue]) {
    [self finish];
    return;
  }
  _sinks = [state[@"sinks"] isKindOfClass:NSArray.class] ? state[@"sinks"] : @[];
  if ([state[@"permissionRejected"] boolValue])
    _note.stringValue = @"Wing can't look for devices. Allow Wing under System Settings → "
                        @"Privacy & Security → Local Network.";
  [self render];
  if (!_shown && !_tab.closed) {
    _shown = YES;
    [_popover showRelativeToRect:_anchor ofView:_view preferredEdge:NSRectEdgeMaxY];
  }
}

- (void)render {
  if (_finished)
    return;
  for (NSView *row in [_list.arrangedSubviews copy]) {
    [_list removeArrangedSubview:row];
    [row removeFromSuperview];
  }
  for (NSDictionary *sink in _sinks) {
    NSString *state = sink[@"state"];
    NSString *detail = [sink[@"issue"] length] ? sink[@"issue"]
                       : [state isEqual:@"connected"] ? @"Casting · click to stop"
                       : [state isEqual:@"connecting"] ? @"Connecting…"
                       : [state isEqual:@"disconnecting"] ? @"Stopping…"
                       : [sink[@"status"] length] ? sink[@"status"] : @"";
    NSString *title = detail.length ? [NSString stringWithFormat:@"%@\n%@", sink[@"name"], detail]
                                    : sink[@"name"];
    NSButton *row = [NSButton buttonWithTitle:title target:self action:@selector(choose:)];
    row.bezelStyle = NSBezelStyleRecessed;
    row.showsBorderOnlyWhileMouseInside = YES;
    row.alignment = NSTextAlignmentLeft;
    row.imagePosition = NSImageLeading;
    row.image = [NSImage imageWithSystemSymbolName:[state isEqual:@"connected"] ? @"tv.fill" : @"tv"
                          accessibilityDescription:nil];
    row.tag = (NSInteger)[_sinks indexOfObject:sink];
    row.enabled = ![state isEqual:@"unavailable"] && ![state isEqual:@"connecting"] &&
                  ![state isEqual:@"disconnecting"];
    NSMutableAttributedString *text = [[NSMutableAttributedString alloc]
        initWithString:title
            attributes:@{NSFontAttributeName : [NSFont systemFontOfSize:13]}];
    if (detail.length)
      [text addAttributes:@{
        NSFontAttributeName : [NSFont systemFontOfSize:11],
        NSForegroundColorAttributeName : NSColor.secondaryLabelColor
      }
                    range:NSMakeRange(title.length - detail.length, detail.length)];
    row.attributedTitle = text;
    [row.widthAnchor constraintEqualToConstant:272].active = YES;
    [row.heightAnchor constraintGreaterThanOrEqualToConstant:detail.length ? 40 : 28].active = YES;
    [_list addArrangedSubview:row];
  }
  if (!_sinks.count) {
    NSTextField *empty = [NSTextField wrappingLabelWithString:
        _searchedLong ? @"No devices found. Make sure your Chromecast or TV is on and on the same Wi-Fi as this Mac."
                      : @"Looking for devices…"];
    empty.textColor = NSColor.secondaryLabelColor;
    [empty.widthAnchor constraintEqualToConstant:272].active = YES;
    [_list addArrangedSubview:empty];
  }
  _note.hidden = !_note.stringValue.length;
}

- (void)choose:(NSButton *)sender {
  [self chooseSinkAtIndex:sender.tag];
}
- (void)chooseSinkAtIndex:(NSInteger)index {
  if (index < 0 || index >= (NSInteger)_sinks.count)
    return;
  NSDictionary *sink = _sinks[index];
  if ([sink[@"state"] isEqual:@"connected"] && [sink[@"routeId"] length]) {
    [ArdiaCoreEngine stopCasting:_identity route:sink[@"routeId"]];
    return;
  }
  int modes = [sink[@"modes"] intValue];
  for (int mode : kCastModes)
    if (modes & mode) {
      [ArdiaCoreEngine startCasting:_identity sink:sink[@"id"] mode:mode];
      return;
    }
}

- (void)popoverDidClose:(NSNotification *)notification {
  if (_finished)
    return;
  [ArdiaCoreEngine closeCastDialog:_identity];
  [self finish];
}

- (void)close {
  if (_finished)
    return;
  [ArdiaCoreEngine closeCastDialog:_identity];
  [self finish];
}

- (void)finish {
  if (_finished)
    return;
  _finished = YES;
  _popover.delegate = nil;
  [_popover close];
  if (_onClose)
    _onClose();
}
@end

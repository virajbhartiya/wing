#import "SharePicker.h"
#import <CoreGraphics/CoreGraphics.h>

// Lists scroll from the top, so the first sources are the ones in view.
@interface WingShareFlippedView : NSView
@end
@implementation WingShareFlippedView
- (BOOL)isFlipped {
  return YES;
}
@end

// One source: icon, name, and the app or address in secondary text. The whole
// row highlights under the pointer and picks the source on click.
@interface WingShareRow : NSView
@property(weak) id target;
@property SEL action;
@end
@implementation WingShareRow {
  BOOL _hovered;
}
- (void)updateTrackingAreas {
  for (NSTrackingArea *area in self.trackingAreas) [self removeTrackingArea:area];
  [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect
      options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
        owner:self userInfo:nil]];
  [super updateTrackingAreas];
}
- (void)setHovered:(BOOL)hovered {
  _hovered = hovered;
  self.needsDisplay = YES;
}
- (void)mouseEntered:(NSEvent *)event {
  [self setHovered:YES];
}
- (void)mouseExited:(NSEvent *)event {
  [self setHovered:NO];
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
- (void)mouseDown:(NSEvent *)event {
}
- (void)mouseUp:(NSEvent *)event {
  if (NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], self.bounds))
    [self accessibilityPerformPress];
}
- (BOOL)accessibilityPerformPress {
  [NSApp sendAction:self.action to:self.target from:self];
  return YES;
}
- (void)drawRect:(NSRect)rect {
  if (!_hovered) return;
  [[NSColor.labelColor colorWithAlphaComponent:0.09] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:6 yRadius:6] fill];
}
@end

static NSView *WingSharePadded(NSView *view, CGFloat leading) {
  NSView *box = [NSView new];
  view.translatesAutoresizingMaskIntoConstraints = NO;
  [box addSubview:view];
  [NSLayoutConstraint activateConstraints:@[
    [view.leadingAnchor constraintEqualToAnchor:box.leadingAnchor constant:leading],
    [view.trailingAnchor constraintEqualToAnchor:box.trailingAnchor constant:-leading],
    [view.topAnchor constraintEqualToAnchor:box.topAnchor],
    [view.bottomAnchor constraintEqualToAnchor:box.bottomAnchor],
  ]];
  return box;
}

static const CGFloat kShareWidth = 340, kShareListWidth = kShareWidth - 16;

@interface WingSharePicker () <NSPopoverDelegate>
@end

@implementation WingSharePicker {
  NSPopover *_popover;
  NSArray<NSDictionary *> *_sources;
  NSButton *_audio;
  NSScrollView *_scroll;
  void (^_completion)(NSString *, NSString *);
  BOOL _askAudio;
}

+ (BOOL)canCaptureScreen {
  return CGPreflightScreenCaptureAccess();
}

+ (NSArray<NSDictionary *> *)screenAndWindowSources {
  NSMutableArray *sources = [NSMutableArray new];
  NSUInteger index = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    index++;
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"screen:%u:0", display.unsignedIntValue],
      @"kind" : @"screen",
      @"name" : screen.localizedName.length ? screen.localizedName
                                             : [NSString stringWithFormat:@"Screen %lu", (unsigned long)index],
      @"detail" : [NSString stringWithFormat:@"%.0f × %.0f", screen.frame.size.width, screen.frame.size.height],
    }];
  }
  NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  const pid_t me = getpid();
  for (NSDictionary *window in windows) {
    if ([window[(id)kCGWindowLayer] intValue] != 0 || [window[(id)kCGWindowOwnerPID] intValue] == me)
      continue;
    NSDictionary *bounds = window[(id)kCGWindowBounds];
    if ([bounds[@"Width"] doubleValue] < 80 || [bounds[@"Height"] doubleValue] < 80)
      continue;
    NSString *app = window[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = window[(id)kCGWindowName];
    NSRunningApplication *running =
        [NSRunningApplication runningApplicationWithProcessIdentifier:[window[(id)kCGWindowOwnerPID] intValue]];
    NSMutableDictionary *source = [@{
      @"id" : [NSString stringWithFormat:@"window:%u:0", [window[(id)kCGWindowNumber] unsignedIntValue]],
      @"kind" : @"window",
      @"name" : title.length ? title : app,
      @"detail" : title.length ? app : @"",
    } mutableCopy];
    if (running.icon) source[@"icon"] = running.icon;
    [sources addObject:source];
  }
  return sources;
}

- (instancetype)initWithSite:(NSString *)site
                     sources:(NSArray<NSDictionary *> *)sources
                    askAudio:(BOOL)askAudio
                  completion:(void (^)(NSString *, NSString *))completion {
  if ((self = [super init])) {
    _sources = sources;
    _askAudio = askAudio;
    _completion = [completion copy];
    NSTextField *header = [NSTextField wrappingLabelWithString:
        [NSString stringWithFormat:@"Choose what %@ can see", site.length ? site : @"this site"]];
    header.font = [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
    NSStackView *list = [NSStackView stackViewWithViews:@[]];
    list.orientation = NSUserInterfaceLayoutOrientationVertical;
    list.alignment = NSLayoutAttributeLeading;
    list.spacing = 0;
    NSDictionary *titles = @{@"tab" : @"Wing tabs", @"window" : @"Windows", @"screen" : @"Entire screen"};
    BOOL allowed = WingSharePicker.canCaptureScreen;
    NSView *notice = nil;
    for (NSString *kind in @[ @"tab", @"window", @"screen" ]) {
      NSArray *group = [sources filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"kind == %@", kind]];
      BOOL blocked = ![kind isEqual:@"tab"] && !allowed;
      if (!group.count && !blocked) continue;
      if (blocked) {
        // Unsigned builds lose this permission on every update, and macOS
        // then hands out black frames instead of an error. Say so up front,
        // outside the list so it never scrolls out of view.
        notice = notice ?: [self permissionCard];
        continue;
      }
      NSTextField *section = [NSTextField labelWithString:titles[kind]];
      section.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
      section.textColor = NSColor.secondaryLabelColor;
      NSView *label = WingSharePadded(section, 8);
      [list addArrangedSubview:label];
      [label.widthAnchor constraintEqualToConstant:kShareListWidth].active = YES;
      [list setCustomSpacing:6 afterView:label];
      for (NSDictionary *source in [group subarrayWithRange:NSMakeRange(0, MIN(group.count, 12))]) {
        NSView *row = [self rowFor:source];
        [list addArrangedSubview:row];
        [row.widthAnchor constraintEqualToConstant:kShareListWidth].active = YES;
      }
      [list setCustomSpacing:14 afterView:list.arrangedSubviews.lastObject];
    }
    NSScrollView *scroll = [NSScrollView new];
    scroll.drawsBackground = NO;
    scroll.hasVerticalScroller = YES;
    scroll.autohidesScrollers = YES;
    scroll.scrollerStyle = NSScrollerStyleOverlay;
    NSView *document = [WingShareFlippedView new];
    document.translatesAutoresizingMaskIntoConstraints = NO;
    list.translatesAutoresizingMaskIntoConstraints = NO;
    [document addSubview:list];
    scroll.documentView = document;
    _scroll = scroll;
    CGFloat listHeight = list.fittingSize.height;
    NSMutableArray *footer = [NSMutableArray new];
    if (askAudio) {
      _audio = [NSButton checkboxWithTitle:@"Also share audio" target:nil action:nil];
      _audio.state = NSControlStateValueOn;
      [footer addObject:_audio];
    }
    NSView *spacer = [NSView new];
    [spacer setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [footer addObject:spacer];
    NSButton *cancel = [NSButton buttonWithTitle:@"Don't Share" target:self action:@selector(cancel:)];
    cancel.keyEquivalent = @"\e";
    [footer addObject:cancel];
    NSStackView *bottom = [NSStackView stackViewWithViews:footer];
    NSBox *rule = [NSBox new];
    rule.boxType = NSBoxSeparator;
    NSView *root = [NSView new];
    for (NSView *view in @[ header, scroll, rule, bottom ]) {
      view.translatesAutoresizingMaskIntoConstraints = NO;
      [root addSubview:view];
    }
    NSView *aboveRule = scroll;
    if (notice) {
      notice.translatesAutoresizingMaskIntoConstraints = NO;
      [root addSubview:notice];
      [NSLayoutConstraint activateConstraints:@[
        [notice.topAnchor constraintEqualToAnchor:scroll.bottomAnchor constant:4],
        [notice.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:8],
        [notice.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-8],
      ]];
      aboveRule = notice;
    }
    [NSLayoutConstraint activateConstraints:@[
      [root.widthAnchor constraintEqualToConstant:kShareWidth],
      [header.topAnchor constraintEqualToAnchor:root.topAnchor constant:14],
      [header.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:16],
      [header.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-16],
      [scroll.topAnchor constraintEqualToAnchor:header.bottomAnchor constant:10],
      [scroll.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:8],
      [scroll.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-8],
      [scroll.heightAnchor constraintEqualToConstant:MIN(notice ? 260 : 380, MAX(28, listHeight))],
      [list.topAnchor constraintEqualToAnchor:document.topAnchor],
      [list.leadingAnchor constraintEqualToAnchor:document.leadingAnchor],
      [list.trailingAnchor constraintEqualToAnchor:document.trailingAnchor],
      [list.bottomAnchor constraintEqualToAnchor:document.bottomAnchor],
      [document.widthAnchor constraintEqualToAnchor:scroll.contentView.widthAnchor],
      [rule.topAnchor constraintEqualToAnchor:aboveRule.bottomAnchor constant:notice ? 12 : 2],
      [rule.leadingAnchor constraintEqualToAnchor:root.leadingAnchor],
      [rule.trailingAnchor constraintEqualToAnchor:root.trailingAnchor],
      [bottom.topAnchor constraintEqualToAnchor:rule.bottomAnchor constant:10],
      [bottom.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:16],
      [bottom.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-14],
      [bottom.bottomAnchor constraintEqualToAnchor:root.bottomAnchor constant:-12],
    ]];
    [root layoutSubtreeIfNeeded];
    root.frame = (NSRect){NSZeroPoint, root.fittingSize};
    NSViewController *controller = [NSViewController new];
    controller.view = root;
    controller.preferredContentSize = root.fittingSize;
    _popover = [NSPopover new];
    _popover.behavior = NSPopoverBehaviorTransient;
    _popover.contentViewController = controller;
    _popover.delegate = self;
  }
  return self;
}

- (NSView *)permissionCard {
  NSImageView *symbol = [NSImageView imageViewWithImage:
      [NSImage imageWithSystemSymbolName:@"rectangle.dashed.badge.record" accessibilityDescription:nil]];
  symbol.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightRegular];
  symbol.contentTintColor = NSColor.secondaryLabelColor;
  NSTextField *title = [NSTextField labelWithString:@"Wing needs Screen Recording access"];
  title.font = [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold];
  NSTextField *body = [NSTextField wrappingLabelWithString:
      @"Turn Wing on in Privacy & Security → Screen & System Audio Recording, then quit and reopen Wing. "
      @"If it's already on, remove Wing with the − button and add it again."];
  body.font = [NSFont systemFontOfSize:11];
  body.textColor = NSColor.secondaryLabelColor;
  body.preferredMaxLayoutWidth = kShareListWidth - 24 - 26;
  NSButton *open = [NSButton buttonWithTitle:@"Open Privacy Settings…" target:self action:@selector(openSettings:)];
  open.controlSize = NSControlSizeSmall;
  open.font = [NSFont systemFontOfSize:NSFont.smallSystemFontSize];
  NSStackView *text = [NSStackView stackViewWithViews:@[ title, body, open ]];
  text.orientation = NSUserInterfaceLayoutOrientationVertical;
  text.alignment = NSLayoutAttributeLeading;
  text.spacing = 4;
  [text setCustomSpacing:10 afterView:body];
  NSView *card = [NSView new];
  card.wantsLayer = YES;
  card.layer.cornerRadius = 8;
  card.layer.backgroundColor = [NSColor.labelColor colorWithAlphaComponent:0.06].CGColor;
  for (NSView *view in @[ symbol, text ]) {
    view.translatesAutoresizingMaskIntoConstraints = NO;
    [card addSubview:view];
  }
  [NSLayoutConstraint activateConstraints:@[
    [symbol.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:12],
    [symbol.topAnchor constraintEqualToAnchor:card.topAnchor constant:12],
    [symbol.widthAnchor constraintEqualToConstant:18],
    [text.leadingAnchor constraintEqualToAnchor:symbol.trailingAnchor constant:8],
    [text.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-12],
    [text.topAnchor constraintEqualToAnchor:card.topAnchor constant:12],
    [text.bottomAnchor constraintEqualToAnchor:card.bottomAnchor constant:-12],
  ]];
  return card;
}

- (NSView *)rowFor:(NSDictionary *)source {
  NSImage *icon = source[@"icon"];
  if (!icon)
    icon = [NSImage imageWithSystemSymbolName:[source[@"kind"] isEqual:@"screen"] ? @"display"
                                              : [source[@"kind"] isEqual:@"tab"] ? @"globe" : @"macwindow"
                     accessibilityDescription:nil];
  icon = [icon copy];
  icon.size = NSMakeSize(16, 16);
  NSImageView *image = [NSImageView imageViewWithImage:icon];
  image.contentTintColor = NSColor.secondaryLabelColor;
  NSMutableAttributedString *title = [[NSMutableAttributedString alloc]
      initWithString:source[@"name"] ?: @""
          attributes:@{NSFontAttributeName : [NSFont systemFontOfSize:13],
                       NSForegroundColorAttributeName : NSColor.labelColor}];
  if ([source[@"detail"] length])
    [title appendAttributedString:[[NSAttributedString alloc]
        initWithString:[@"  " stringByAppendingString:source[@"detail"]]
            attributes:@{NSFontAttributeName : [NSFont systemFontOfSize:12],
                         NSForegroundColorAttributeName : NSColor.secondaryLabelColor}]];
  NSTextField *label = [NSTextField labelWithAttributedString:title];
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  label.maximumNumberOfLines = 1;
  label.cell.wraps = NO;
  label.cell.truncatesLastVisibleLine = YES;
  [label setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                                  forOrientation:NSLayoutConstraintOrientationHorizontal];
  WingShareRow *row = [WingShareRow new];
  row.target = self;
  row.action = @selector(choose:);
  row.identifier = source[@"id"];
  row.toolTip = source[@"name"];
  row.accessibilityRole = NSAccessibilityButtonRole;
  row.accessibilityLabel = source[@"name"];
  for (NSView *view in @[ image, label ]) {
    view.translatesAutoresizingMaskIntoConstraints = NO;
    [row addSubview:view];
  }
  [NSLayoutConstraint activateConstraints:@[
    [row.heightAnchor constraintEqualToConstant:28],
    [image.leadingAnchor constraintEqualToAnchor:row.leadingAnchor constant:8],
    [image.centerYAnchor constraintEqualToAnchor:row.centerYAnchor],
    [image.widthAnchor constraintEqualToConstant:16],
    [image.heightAnchor constraintEqualToConstant:16],
    [label.leadingAnchor constraintEqualToAnchor:image.trailingAnchor constant:8],
    [label.trailingAnchor constraintLessThanOrEqualToAnchor:row.trailingAnchor constant:-8],
    [label.centerYAnchor constraintEqualToAnchor:row.centerYAnchor],
  ]];
  return row;
}

- (void)showInView:(NSView *)view anchor:(NSRect)anchor edge:(NSRectEdge)edge {
  [_popover showRelativeToRect:anchor ofView:view preferredEdge:edge];
  [_scroll.documentView scrollPoint:NSZeroPoint];
}

- (void)finish:(NSString *)sourceId {
  void (^completion)(NSString *, NSString *) = _completion;
  _completion = nil;
  if (!completion) return;
  NSString *audio = nil;
  if (sourceId && _askAudio && _audio.state == NSControlStateValueOn)
    audio = [sourceId hasPrefix:@"screen:"] ? @"system"
          : [sourceId hasPrefix:@"window:"] ? @"application" : @"tab";
  completion(sourceId, audio);
}

- (void)choose:(NSView *)sender {
  [self finish:sender.identifier];
  [_popover close];
}

- (void)cancel:(id)sender {
  [_popover close];
}

- (void)openSettings:(id)sender {
  CGRequestScreenCaptureAccess();
  [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:
      @"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]];
}

- (void)close {
  [_popover close];
  [self finish:nil];
}

- (void)popoverDidClose:(NSNotification *)notification {
  [self finish:nil];
}
@end

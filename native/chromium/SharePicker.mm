#import "SharePicker.h"
#import <CoreGraphics/CoreGraphics.h>

@interface WingSharePicker () <NSPopoverDelegate>
@end

@implementation WingSharePicker {
  NSPopover *_popover;
  NSArray<NSDictionary *> *_sources;
  NSButton *_audio;
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
    list.spacing = 1;
    NSDictionary *titles = @{@"tab" : @"Wing tabs", @"window" : @"Windows", @"screen" : @"Entire screen"};
    BOOL allowed = WingSharePicker.canCaptureScreen;
    for (NSString *kind in @[ @"tab", @"window", @"screen" ]) {
      NSArray *group = [sources filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"kind == %@", kind]];
      if (!group.count && ![kind isEqual:@"screen"]) continue;
      NSTextField *section = [NSTextField labelWithString:titles[kind]];
      section.font = [NSFont systemFontOfSize:11 weight:NSFontWeightMedium];
      section.textColor = NSColor.secondaryLabelColor;
      [list addArrangedSubview:section];
      [list setCustomSpacing:4 afterView:section];
      if (![kind isEqual:@"tab"] && !allowed) {
        // Unsigned builds lose this permission on every update, and macOS
        // then hands out black frames instead of an error. Say so up front.
        NSTextField *note = [NSTextField wrappingLabelWithString:
            @"macOS hasn't given Wing Screen Recording access. Turn Wing on in Privacy & Security → "
            @"Screen & System Audio Recording. If it's already on, remove it and add it again."];
        note.font = [NSFont systemFontOfSize:11];
        note.textColor = NSColor.secondaryLabelColor;
        [note.widthAnchor constraintEqualToConstant:300].active = YES;
        NSButton *open = [NSButton buttonWithTitle:@"Open Privacy Settings…" target:self action:@selector(openSettings:)];
        open.controlSize = NSControlSizeSmall;
        [list addArrangedSubview:note];
        [list addArrangedSubview:open];
        [list setCustomSpacing:12 afterView:open];
        continue;
      }
      for (NSDictionary *source in [group subarrayWithRange:NSMakeRange(0, MIN(group.count, 12))])
        [list addArrangedSubview:[self rowFor:source]];
      [list setCustomSpacing:12 afterView:list.arrangedSubviews.lastObject];
    }
    NSScrollView *scroll = [NSScrollView new];
    scroll.drawsBackground = NO;
    scroll.hasVerticalScroller = YES;
    scroll.autohidesScrollers = YES;
    NSView *document = [NSView new];
    document.translatesAutoresizingMaskIntoConstraints = NO;
    list.translatesAutoresizingMaskIntoConstraints = NO;
    [document addSubview:list];
    scroll.documentView = document;
    [NSLayoutConstraint activateConstraints:@[
      [list.topAnchor constraintEqualToAnchor:document.topAnchor],
      [list.leadingAnchor constraintEqualToAnchor:document.leadingAnchor],
      [list.trailingAnchor constraintEqualToAnchor:document.trailingAnchor],
      [list.bottomAnchor constraintEqualToAnchor:document.bottomAnchor],
      [document.widthAnchor constraintEqualToAnchor:scroll.contentView.widthAnchor],
      [scroll.widthAnchor constraintEqualToConstant:320],
      [scroll.heightAnchor constraintEqualToConstant:MIN(380, MAX(120, list.fittingSize.height))],
    ]];
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
    [bottom.widthAnchor constraintEqualToConstant:320].active = YES;
    NSStackView *content = [NSStackView stackViewWithViews:@[ header, scroll, bottom ]];
    content.orientation = NSUserInterfaceLayoutOrientationVertical;
    content.alignment = NSLayoutAttributeLeading;
    content.spacing = 10;
    content.edgeInsets = NSEdgeInsetsMake(14, 14, 12, 14);
    [header.widthAnchor constraintEqualToConstant:320].active = YES;
    NSViewController *controller = [NSViewController new];
    controller.view = content;
    _popover = [NSPopover new];
    _popover.behavior = NSPopoverBehaviorTransient;
    _popover.contentViewController = controller;
    _popover.delegate = self;
  }
  return self;
}

- (NSButton *)rowFor:(NSDictionary *)source {
  NSString *title = source[@"name"];
  if ([source[@"detail"] length])
    title = [NSString stringWithFormat:@"%@ — %@", title, source[@"detail"]];
  NSButton *row = [NSButton buttonWithTitle:title target:self action:@selector(choose:)];
  row.bordered = NO;
  row.alignment = NSTextAlignmentLeft;
  row.lineBreakMode = NSLineBreakByTruncatingTail;
  row.identifier = source[@"id"];
  row.toolTip = source[@"name"];
  NSImage *icon = source[@"icon"];
  if (!icon)
    icon = [NSImage imageWithSystemSymbolName:[source[@"kind"] isEqual:@"screen"] ? @"display"
                                              : [source[@"kind"] isEqual:@"tab"] ? @"globe" : @"macwindow"
                     accessibilityDescription:nil];
  icon = [icon copy];
  icon.size = NSMakeSize(16, 16);
  row.image = icon;
  row.imagePosition = NSImageLeading;
  row.imageHugsTitle = YES;
  [row.widthAnchor constraintEqualToConstant:304].active = YES;
  [row.heightAnchor constraintEqualToConstant:24].active = YES;
  return row;
}

- (void)showInView:(NSView *)view anchor:(NSRect)anchor edge:(NSRectEdge)edge {
  [_popover showRelativeToRect:anchor ofView:view preferredEdge:edge];
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

- (void)choose:(NSButton *)sender {
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

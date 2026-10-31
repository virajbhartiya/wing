#import "PromptPopover.h"

@interface WingPromptPopover () <NSPopoverDelegate>
@end

@implementation WingPromptPopover {
  NSPopover *_popover;
  NSButton *_remember;
  void (^_completion)(NSInteger, BOOL);
  WingPromptPopover *_retained;
}

+ (instancetype)showInView:(NSView *)view
                    anchor:(NSRect)anchor
                    symbol:(NSString *)symbol
                     title:(NSString *)title
                   message:(NSString *)message
                   buttons:(NSArray<NSString *> *)buttons
                  remember:(NSString *)remember
                completion:(void (^)(NSInteger, BOOL))completion {
  WingPromptPopover *prompt = [WingPromptPopover new];
  [prompt showInView:view
              anchor:anchor
              symbol:symbol
               title:title
             message:message
             buttons:buttons
            remember:remember
          completion:completion];
  return prompt;
}

- (NSTextField *)label:(NSString *)text font:(NSFont *)font color:(NSColor *)color {
  NSTextField *label = [NSTextField wrappingLabelWithString:text];
  label.font = font;
  label.textColor = color;
  label.preferredMaxLayoutWidth = 268;
  label.selectable = NO;
  return label;
}

- (void)showInView:(NSView *)view
            anchor:(NSRect)anchor
            symbol:(NSString *)symbol
             title:(NSString *)title
           message:(NSString *)message
           buttons:(NSArray<NSString *> *)buttons
          remember:(NSString *)remember
        completion:(void (^)(NSInteger, BOOL))completion {
  _completion = [completion copy];
  _retained = self;

  NSImageView *icon = [NSImageView
      imageViewWithImage:[NSImage imageWithSystemSymbolName:symbol
                                   accessibilityDescription:nil]
                             ?: [NSImage imageWithSystemSymbolName:@"globe"
                                          accessibilityDescription:nil]];
  icon.symbolConfiguration = [NSImageSymbolConfiguration
      configurationWithPointSize:17
                          weight:NSFontWeightMedium];
  icon.contentTintColor = NSColor.controlAccentColor;
  [icon setContentHuggingPriority:NSLayoutPriorityRequired
                   forOrientation:NSLayoutConstraintOrientationHorizontal];

  NSTextField *heading = [self label:title
                                font:[NSFont systemFontOfSize:13 weight:NSFontWeightSemibold]
                               color:NSColor.labelColor];
  heading.preferredMaxLayoutWidth = 240;
  NSStackView *header = [NSStackView stackViewWithViews:@[ icon, heading ]];
  header.alignment = NSLayoutAttributeTop;
  header.spacing = 10;

  NSMutableArray<NSView *> *rows = [NSMutableArray arrayWithObject:header];
  if (message.length)
    [rows addObject:[self label:message
                           font:[NSFont systemFontOfSize:12]
                          color:NSColor.secondaryLabelColor]];
  if (remember.length) {
    _remember = [NSButton checkboxWithTitle:remember target:nil action:nil];
    _remember.font = [NSFont systemFontOfSize:12];
    [rows addObject:_remember];
  }

  NSMutableArray<NSButton *> *controls = [NSMutableArray new];
  [buttons enumerateObjectsUsingBlock:^(NSString *name, NSUInteger index, BOOL *stop) {
    NSButton *button = [NSButton buttonWithTitle:name
                                          target:self
                                          action:@selector(choose:)];
    button.tag = (NSInteger)index;
    button.controlSize = NSControlSizeRegular;
    if (index == buttons.count - 1) button.keyEquivalent = @"\r";
    [controls addObject:button];
  }];
  NSView *spacer = [NSView new];
  [spacer setContentHuggingPriority:1
                     forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *actions =
      [NSStackView stackViewWithViews:[@[ spacer ] arrayByAddingObjectsFromArray:controls]];
  actions.spacing = 8;
  [rows addObject:actions];

  NSStackView *stack = [NSStackView stackViewWithViews:rows];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 12;
  stack.edgeInsets = NSEdgeInsetsMake(16, 16, 14, 16);
  [actions.widthAnchor constraintEqualToAnchor:stack.widthAnchor constant:-32].active = YES;
  [stack.widthAnchor constraintEqualToConstant:316].active = YES;

  NSViewController *controller = [NSViewController new];
  controller.view = stack;
  [stack layoutSubtreeIfNeeded];

  _popover = [NSPopover new];
  _popover.contentViewController = controller;
  // Prompts wait for an answer, but clicking elsewhere still dismisses them.
  _popover.behavior = NSPopoverBehaviorSemitransient;
  _popover.animates = YES;
  _popover.delegate = self;
  [_popover showRelativeToRect:anchor
                      ofView:view
               preferredEdge:view.isFlipped ? NSRectEdgeMaxY : NSRectEdgeMinY];
}

- (void)finish:(NSInteger)choice {
  void (^completion)(NSInteger, BOOL) = _completion;
  _completion = nil;
  BOOL remember = _remember.state == NSControlStateValueOn;
  if (completion) completion(choice, remember);
}

- (void)choose:(NSButton *)sender {
  [self finish:sender.tag];
  [_popover close];
}

- (void)dismiss {
  _completion = nil;
  [_popover close];
}

- (void)popoverDidClose:(NSNotification *)notification {
  [self finish:-1];
  _retained = nil;
}
@end

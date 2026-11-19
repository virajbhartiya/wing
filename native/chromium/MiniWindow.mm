#import "MiniWindow.h"
#import "ArdiaCore.h"
#import "ChromeControls.h"

static NSMutableArray *gMinis;

@interface WingMiniWindow () <ArdiaCoreWindowDelegate, ArdiaCoreTabDelegate, NSToolbarDelegate,
                              NSTextFieldDelegate>
@end

@implementation WingMiniWindow {
  ArdiaCoreWindow *_core;
  ArdiaCoreTab *_tab;
  NSTextField *_address;
  NSPopUpButton *_profile;
  WingChromeControl *_back, *_forward, *_reload, *_expand;
  WingAddressPill *_pill;
  NSArray<NSDictionary *> *_spaces;
  NSString *_spaceId, *_search, *_lastVisit;
  WingMiniProfileLoader _loader;
  WingMiniExpand _expandHandler;
  WingMiniVisit _visit;
  BOOL _closing, _opening;
}

+ (NSUInteger)openCount {
  return gMinis.count;
}

+ (NSWindow *)windowForTab:(ArdiaCoreTab *)tab {
  for (WingMiniWindow *mini in gMinis)
    if (tab && mini->_tab == tab && !tab.closed) return mini->_core.window;
  return nil;
}

+ (NSArray<NSDictionary *> *)diagnostics {
  NSMutableArray *windows = [NSMutableArray new];
  for (WingMiniWindow *mini in gMinis)
    [windows addObject:@{
      @"url" : mini->_tab.url ?: @"",
      @"profile" : mini->_tab.profile.name ?: @"",
      @"spaceId" : mini->_spaceId ?: @"",
      @"visible" : @(mini->_core.window.visible)
    }];
  return windows;
}
+ (void)closeAll {
  for (WingMiniWindow *mini in [gMinis copy]) [mini->_core.window performClose:nil];
}

+ (void)openURL:(NSString *)url
         spaces:(NSArray<NSDictionary *> *)spaces
        spaceId:(NSString *)spaceId
         search:(NSString *)searchPrefix
         loader:(WingMiniProfileLoader)loader
         expand:(WingMiniExpand)expand
          visit:(WingMiniVisit)visit {
  WingMiniWindow *mini = [self new];
  mini->_spaces = spaces;
  mini->_spaceId = spaceId;
  mini->_search = searchPrefix;
  mini->_loader = loader;
  mini->_expandHandler = expand;
  mini->_visit = visit;
  gMinis = gMinis ?: [NSMutableArray new];
  [gMinis addObject:mini];
  [mini loadPage:url adopting:nil];
}

- (NSString *)profileIdForSpace:(NSString *)spaceId {
  for (NSDictionary *space in _spaces)
    if ([space[@"id"] isEqual:spaceId]) return space[@"profileId"];
  return _spaces.firstObject[@"profileId"];
}

- (void)loadPage:(NSString *)url adopting:(ArdiaCoreTab *)adopted {
  _loader([self profileIdForSpace:_spaceId], ^(ArdiaCoreProfile *profile) {
    if (self->_closing) return;
    if (!profile) {
      if (!self->_core) [gMinis removeObject:self];
      return;
    }
    [self attachProfile:profile url:url adopting:adopted];
  });
}

- (void)attachProfile:(ArdiaCoreProfile *)profile url:(NSString *)url adopting:(ArdiaCoreTab *)adopted {
  BOOL first = !_core;
  if (first) {
    _core = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 960, 620)];
    _core.delegate = self;
  }
  [_core prepareProfile:profile];
  _core.activeProfile = profile;
  ArdiaCoreTab *previous = _tab;
  _opening = YES;
  if (adopted) {
    [_core adoptTab:adopted];
    _tab = adopted;
  } else
    _tab = [_core openTab:url.length ? url : @"about:blank" profile:profile foreground:YES];
  _opening = NO;
  _tab.delegate = self;
  NSView *host = _core.hostView;
  // A rounded card on the Space's color, like pages in the main window.
  NSRect card = NSInsetRect(host.bounds, 6, 0);
  card.size.height -= 6;
  if (!host.isFlipped) card.origin.y += 6;
  _tab.view.frame = card;
  _tab.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _tab.view.wantsLayer = YES;
  _tab.view.layer.cornerRadius = 10;
  _tab.view.layer.cornerCurve = @"continuous";
  _tab.view.layer.masksToBounds = YES;
  [host addSubview:_tab.view];
  [_tab noteShownByHost:YES];
  [_core activateTab:_tab];
  if (previous) {
    previous.delegate = nil;
    [previous.view removeFromSuperview];
    [previous closeNow];
  }
  if (first) {
    NSWindow *window = _core.window;
    window.title = @"Mini Wing";
    window.minSize = NSMakeSize(520, 300);
    window.toolbarStyle = NSWindowToolbarStyleUnified;
    window.titleVisibility = NSWindowTitleHidden;
    window.titlebarAppearsTransparent = YES;
    window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
    NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"WingMiniToolbar"];
    toolbar.delegate = self;
    toolbar.displayMode = NSToolbarDisplayModeIconOnly;
    window.toolbar = toolbar;
    [self buildBar];
    [window center];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    if (!url.length && !adopted) [window makeFirstResponder:_address];
  }
  [self applyTheme];
  [self refresh];
}

// The window takes the chosen Space's frame color and light or dark look.
- (void)applyTheme {
  NSDictionary *chrome = nil;
  for (NSDictionary *space in _spaces)
    if ([space[@"id"] isEqual:_spaceId] && [space[@"chrome"] isKindOfClass:NSDictionary.class])
      chrome = space[@"chrome"];
  BOOL dark = chrome ? [chrome[@"dark"] boolValue]
                     : [NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[
                         NSAppearanceNameAqua, NSAppearanceNameDarkAqua
                       ]] == NSAppearanceNameDarkAqua;
  NSWindow *window = _core.window;
  window.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  NSColor *base = WingHexColor(chrome[@"base"], NSColor.windowBackgroundColor);
  NSColor *ink = WingHexColor(chrome[@"text"], NSColor.labelColor);
  NSColor *muted = WingHexColor(chrome[@"muted"], NSColor.secondaryLabelColor);
  NSColor *hover = WingHexColor(chrome[@"hover"], [NSColor.labelColor colorWithAlphaComponent:0.08]);
  NSColor *selected = WingHexColor(chrome[@"selected"], [NSColor.labelColor colorWithAlphaComponent:0.14]);
  window.backgroundColor = base;
  _core.hostView.wantsLayer = YES;
  _core.hostView.layer.backgroundColor = base.CGColor;
  for (WingChromeControl *backing in @[ _back ?: NSNull.null, _forward ?: NSNull.null, _reload ?: NSNull.null,
                                        _expand ?: NSNull.null ]) {
    if (![backing isKindOfClass:WingChromeControl.class]) continue;
    backing.hoverColor = hover;
    backing.pressColor = selected;
    ((NSButton *)backing.subviews.firstObject).contentTintColor = muted;
  }
  _pill.restFill = hover;
  _pill.hoverColor = selected;
  _pill.pressColor = selected;
  _address.textColor = ink;
  _address.placeholderAttributedString = [[NSAttributedString alloc]
      initWithString:@"Search or enter website"
          attributes:@{NSForegroundColorAttributeName : muted, NSFontAttributeName : _address.font ?: [NSFont systemFontOfSize:13]}];
  _profile.contentTintColor = muted;
}

#pragma mark Toolbar

// macOS 26 wraps toolbar items in glass capsules that look nothing like the
// main window. The toolbar stays empty, only to give the title bar its height,
// and Wing's own controls sit in the title bar instead.
- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  return @[];
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return @[];
}
- (WingChromeControl *)button:(NSString *)symbol label:(NSString *)label action:(SEL)action {
  NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:label];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:14
                                                                                             weight:NSFontWeightMedium]];
  WingChromeButton *button = [WingChromeButton buttonWithImage:image target:self action:action];
  button.bordered = NO;
  button.imageScaling = NSImageScaleNone;
  button.toolTip = label;
  button.frame = NSMakeRect(0, 0, 30, 28);
  button.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  WingChromeControl *backing = [[WingChromeControl alloc] initWithFrame:button.frame];
  [backing addSubview:button];
  [backing.widthAnchor constraintEqualToConstant:30].active = YES;
  [backing.heightAnchor constraintEqualToConstant:28].active = YES;
  return backing;
}
- (void)buildBar {
  NSWindow *window = _core.window;
  NSView *titlebar = [window standardWindowButton:NSWindowCloseButton].superview;
  if (!titlebar) return;
  _back = [self button:@"arrow.left" label:@"Back" action:@selector(goBack:)];
  _forward = [self button:@"arrow.right" label:@"Forward" action:@selector(goForward:)];
  _reload = [self button:@"arrow.clockwise" label:@"Reload" action:@selector(reloadOrStop:)];
  _expand = [self button:@"arrow.up.left.and.arrow.down.right" label:@"Open in Wing" action:@selector(expand:)];

  _profile = [NSPopUpButton new];
  _profile.bordered = NO;
  _profile.font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
  for (NSDictionary *space in _spaces) {
    NSString *title = [NSString stringWithFormat:@"%@ %@", space[@"icon"] ?: @"", space[@"name"] ?: @""];
    [_profile addItemWithTitle:[title stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]];
    _profile.lastItem.representedObject = space[@"id"];
    if ([space[@"id"] isEqual:_spaceId]) [_profile selectItem:_profile.lastItem];
  }
  _profile.target = self;
  _profile.action = @selector(chooseProfile:);
  [_profile.widthAnchor constraintLessThanOrEqualToConstant:140].active = YES;
  [_profile setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                                     forOrientation:NSLayoutConstraintOrientationHorizontal];
  _profile.toolTip = @"Open in profile";

  _address = [NSTextField new];
  _address.placeholderString = @"Search or enter website";
  _address.bezeled = NO;
  _address.bordered = NO;
  _address.drawsBackground = NO;
  _address.focusRingType = NSFocusRingTypeNone;
  _address.alignment = NSTextAlignmentCenter;
  _address.font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
  _address.lineBreakMode = NSLineBreakByTruncatingTail;
  _address.cell.scrollable = YES;
  _address.cell.usesSingleLineMode = YES;
  _address.target = self;
  _address.action = @selector(go:);
  _address.delegate = self;
  _address.translatesAutoresizingMaskIntoConstraints = NO;
  _pill = [WingAddressPill new];
  _pill.layer.cornerRadius = 10;
  [_pill addSubview:_address];
  [_pill setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [_pill setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];

  NSStackView *bar = [NSStackView stackViewWithViews:@[ _back, _forward, _reload, _pill, _profile, _expand ]];
  bar.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  bar.alignment = NSLayoutAttributeCenterY;
  bar.spacing = 2;
  [bar setCustomSpacing:10 afterView:_reload];
  [bar setCustomSpacing:8 afterView:_pill];
  [bar setCustomSpacing:4 afterView:_profile];
  bar.translatesAutoresizingMaskIntoConstraints = NO;
  [titlebar addSubview:bar];
  // Past the traffic lights, like the main window's toolbar.
  NSView *zoom = [window standardWindowButton:NSWindowZoomButton];
  [NSLayoutConstraint activateConstraints:@[
    [_pill.heightAnchor constraintEqualToConstant:31],
    [_address.leadingAnchor constraintEqualToAnchor:_pill.leadingAnchor constant:12],
    [_address.trailingAnchor constraintEqualToAnchor:_pill.trailingAnchor constant:-12],
    [_address.centerYAnchor constraintEqualToAnchor:_pill.centerYAnchor],
    [bar.leadingAnchor constraintEqualToAnchor:zoom ? zoom.trailingAnchor : titlebar.leadingAnchor
                                      constant:zoom ? 14 : 84],
    [bar.trailingAnchor constraintEqualToAnchor:titlebar.trailingAnchor constant:-10],
    [bar.centerYAnchor constraintEqualToAnchor:zoom ? zoom.centerYAnchor : titlebar.centerYAnchor],
  ]];
}

// Like Safari's compact bar: the site name at rest, the full address to edit.
- (void)controlTextDidBeginEditing:(NSNotification *)notification {
  _address.alignment = NSTextAlignmentLeft;
  _address.stringValue = [self visibleURL];
}
- (void)controlTextDidEndEditing:(NSNotification *)notification {
  _address.alignment = NSTextAlignmentCenter;
  [self refresh];
}

#pragma mark Actions

- (NSString *)visibleURL {
  NSString *url = _tab.url ?: @"";
  return [url isEqual:@"about:blank"] ? @"" : url;
}
- (NSString *)resolve:(NSString *)input {
  NSString *value = [input stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSURL *url = [NSURL URLWithString:value];
  if ([@[ @"http", @"https" ] containsObject:url.scheme.lowercaseString] && url.host.length)
    return url.absoluteString;
  NSRegularExpression *host = [NSRegularExpression
      regularExpressionWithPattern:@"^(localhost|[\\w-]+(\\.[\\w-]+)+)(:\\d+)?(/\\S*)?$"
                           options:NSRegularExpressionCaseInsensitive
                             error:nil];
  if (![value containsString:@" "] &&
      [host numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)])
    return [([value hasPrefix:@"localhost"] ? @"http://" : @"https://") stringByAppendingString:value];
  NSString *query = [value stringByAddingPercentEncodingWithAllowedCharacters:
                               NSCharacterSet.URLQueryAllowedCharacterSet];
  query = [query stringByReplacingOccurrencesOfString:@"&" withString:@"%26"];
  query = [query stringByReplacingOccurrencesOfString:@"+" withString:@"%2B"];
  return [_search stringByAppendingString:query ?: @""];
}
- (void)go:(id)sender {
  if (!_address.stringValue.length) return;
  [_tab loadURL:[self resolve:_address.stringValue] userInitiated:YES];
  [_core.window makeFirstResponder:nil];
  [_tab focus];
}
- (void)goBack:(id)sender { [_tab goBack]; }
- (void)goForward:(id)sender { [_tab goForward]; }
- (void)reloadOrStop:(id)sender {
  if (_tab.loading) [_tab stop];
  else [_tab reload];
}
- (void)chooseProfile:(id)sender {
  NSString *chosen = _profile.selectedItem.representedObject;
  if (!chosen || [chosen isEqual:_spaceId]) return;
  // A page cannot change profile, so reopen it in the new one.
  NSString *url = [self visibleURL];
  _spaceId = chosen;
  _lastVisit = nil;
  [self loadPage:url adopting:nil];
}
- (void)expand:(id)sender {
  NSString *url = [self visibleURL];
  if (!url.length) return;
  // The page itself moves into Wing, so video, scroll and form state stay put.
  ArdiaCoreTab *page = _tab.closed ? nil : _tab;
  if (page) {
    page.delegate = nil;
    [page.view removeFromSuperview];
    _tab = nil;
  }
  _expandHandler(url, _spaceId, page);
  [_core.window performClose:nil];
}

+ (void)expandFirst {
  [gMinis.firstObject expand:nil];
}
+ (BOOL)performMenuAction:(NSString *)name args:(NSDictionary *)args {
  if (!NSApp.keyWindow) return NO;
  for (WingMiniWindow *mini in gMinis)
    if (mini->_core.window == NSApp.keyWindow) {
      [mini perform:name];
      return YES;
    }
  return NO;
}
- (void)perform:(NSString *)name {
  if ([name isEqual:@"close-tab"])
    [_core.window performClose:nil];
  else if ([name isEqual:@"palette-navigate"]) {
    [_core.window makeFirstResponder:_address];
    _address.stringValue = [self visibleURL];
    [_address selectText:nil];
  } else if ([name isEqual:@"reload"])
    [_tab reload];
  else if ([name isEqual:@"back"])
    [_tab goBack];
  else if ([name isEqual:@"forward"])
    [_tab goForward];
}

#pragma mark State

- (void)refresh {
  if (_closing) return;
  NSString *url = [self visibleURL];
  _core.window.title = _tab.title.length && url.length ? _tab.title : @"Mini Wing";
  ((NSButton *)_back.subviews.firstObject).enabled = _tab.canGoBack;
  ((NSButton *)_forward.subviews.firstObject).enabled = _tab.canGoForward;
  ((NSButton *)_expand.subviews.firstObject).enabled = url.length > 0;
  NSButton *reload = _reload.subviews.firstObject;
  NSString *symbol = _tab.loading ? @"xmark" : @"arrow.clockwise";
  if (![reload.image.accessibilityDescription isEqual:symbol]) {
    reload.image = [[NSImage imageWithSystemSymbolName:symbol accessibilityDescription:symbol]
        imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:14
                                                                                    weight:NSFontWeightMedium]];
    reload.toolTip = _tab.loading ? @"Stop" : @"Reload";
  }
  if (_address.currentEditor) return;
  NSString *host = [NSURL URLWithString:url].host;
  if ([host hasPrefix:@"www."]) host = [host substringFromIndex:4];
  _address.stringValue = host.length ? host : url;
  _address.toolTip = url;
}
- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self refresh];
  NSString *url = [self visibleURL];
  if (tab == _tab && [url hasPrefix:@"http"] && ![url isEqual:_lastVisit]) {
    _lastVisit = url;
    _visit(url, tab.title ?: @"", _spaceId);
  }
}
- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeNavigationState:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabWillClose:(ArdiaCoreTab *)tab {
  if (tab == _tab && !_closing) [_core.window performClose:nil];
}

#pragma mark Window

- (void)window:(ArdiaCoreWindow *)window
    didInsertTab:(ArdiaCoreTab *)tab
          opener:(ArdiaCoreTab *)opener
     disposition:(NSString *)disposition {
  if (_opening || tab == _tab) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (tab.closed || self->_closing) return;
    for (WingMiniWindow *mini in gMinis)
      if (mini->_tab == tab) return;
    // A page that keeps opening windows gets its extras closed, not a flood.
    if (gMinis.count >= 20) {
      [tab closeNow];
      return;
    }
    WingMiniWindow *mini = [WingMiniWindow new];
    mini->_spaces = self->_spaces;
    mini->_spaceId = self->_spaceId;
    mini->_search = self->_search;
    mini->_loader = self->_loader;
    mini->_expandHandler = self->_expandHandler;
    mini->_visit = self->_visit;
    [gMinis addObject:mini];
    [mini attachProfile:tab.profile url:nil adopting:tab];
  });
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  if (event.type != NSEventTypeKeyDown) return NO;
  NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (flags == (NSEventModifierFlagCommand | NSEventModifierFlagShift) &&
      [event.charactersIgnoringModifiers.lowercaseString isEqual:@"r"]) {
    [_tab reloadIgnoringCache];
    return YES;
  }
  if (flags != NSEventModifierFlagCommand) return NO;
  NSDictionary *actions = @{
    @"l" : @"palette-navigate",
    @"w" : @"close-tab",
    @"r" : @"reload",
    @"[" : @"back",
    @"]" : @"forward"
  };
  NSString *name = actions[event.charactersIgnoringModifiers.lowercaseString];
  if (!name) return NO;
  [self perform:name];
  return YES;
}

- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window {
  if (_closing) return YES;
  _closing = YES;
  _tab.delegate = nil;
  [_tab closeNow];
  [gMinis removeObject:self];
  return YES;
}
@end

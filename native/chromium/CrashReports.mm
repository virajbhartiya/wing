#import "CrashReports.h"

static NSString *const kBundlePrefix = @"org.wingbrowser.Wing";
static const NSUInteger kLimit = 5;  // per launch, so a crash loop can't flood

static NSURL *StateURL(void) {
  NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory
                                                        inDomains:NSUserDomainMask]
                       .firstObject;
  return [support URLByAppendingPathComponent:@"Wing/crash-reports.json"];
}

static NSMutableDictionary *LoadState(void) {
  NSData *data = [NSData dataWithContentsOfURL:StateURL()];
  NSMutableDictionary *state =
      data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil]
           : nil;
  if (![state isKindOfClass:NSMutableDictionary.class]) {
    // Crashes from before this feature existed are not asked about.
    state = [@{@"since" : @(NSDate.date.timeIntervalSince1970), @"handled" : [NSMutableArray new]} mutableCopy];
  }
  if (![state[@"handled"] isKindOfClass:NSMutableArray.class])
    state[@"handled"] = [NSMutableArray new];
  return state;
}

static void SaveState(NSMutableDictionary *state) {
  NSMutableArray *handled = state[@"handled"];
  if (handled.count > 200)
    [handled removeObjectsInRange:NSMakeRange(0, handled.count - 200)];
  [NSFileManager.defaultManager createDirectoryAtURL:StateURL().URLByDeletingLastPathComponent
                         withIntermediateDirectories:YES
                                          attributes:nil
                                               error:nil];
  [[NSJSONSerialization dataWithJSONObject:state options:0 error:nil] writeToURL:StateURL() atomically:YES];
}

static NSDictionary *Header(NSString *path) {
  NSFileHandle *file = [NSFileHandle fileHandleForReadingAtPath:path];
  NSData *head = [file readDataOfLength:4096];
  [file closeFile];
  NSString *text = [[NSString alloc] initWithData:head encoding:NSUTF8StringEncoding];
  NSString *line = [text componentsSeparatedByString:@"\n"].firstObject;
  id header = line ? [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding]
                                                     options:0
                                                       error:nil]
                   : nil;
  return [header isKindOfClass:NSDictionary.class] ? header : nil;
}

static NSString *Scrubbed(NSString *report) {
  // macOS already writes /Users/USER; catch anything that slipped through.
  NSString *home = NSHomeDirectory();
  return home.length > 1 ? [report stringByReplacingOccurrencesOfString:home withString:@"~"] : report;
}

@implementation WingCrashReports

+ (NSArray<NSString *> *)pendingReports {
  NSMutableDictionary *state = LoadState();
  SaveState(state);
  NSSet *handled = [NSSet setWithArray:state[@"handled"]];
  double since = [state[@"since"] doubleValue];
  NSString *folder = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/DiagnosticReports"];
  NSMutableArray *found = [NSMutableArray new];
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:folder error:nil]) {
    if (![name.pathExtension isEqual:@"ips"] || [handled containsObject:name])
      continue;
    NSString *path = [folder stringByAppendingPathComponent:name];
    NSDate *modified = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil].fileModificationDate;
    if (modified.timeIntervalSince1970 < since)
      continue;
    if (![[Header(path)[@"bundleID"] description] hasPrefix:kBundlePrefix])
      continue;
    [found addObject:@[ modified, path ]];
  }
  [found sortUsingComparator:^NSComparisonResult(NSArray *a, NSArray *b) {
    return [a[0] compare:b[0]];
  }];
  NSMutableArray *paths = [NSMutableArray new];
  for (NSArray *entry in found)
    if (paths.count < kLimit)
      [paths addObject:entry[1]];
  return paths;
}

+ (void)markHandled:(NSArray<NSString *> *)paths {
  NSMutableDictionary *state = LoadState();
  for (NSString *path in paths)
    if (![state[@"handled"] containsObject:path.lastPathComponent])
      [state[@"handled"] addObject:path.lastPathComponent];
  SaveState(state);
}

+ (void)dismissReports:(NSArray<NSString *> *)paths {
  [self markHandled:paths];
}

+ (void)sendReports:(NSArray<NSString *> *)paths to:(NSURL *)endpoint {
  if (!endpoint || !paths.count)
    return;
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSString *arch =
#if defined(__arm64__)
      @"arm64";
#else
      @"x64";
#endif
  for (NSString *path in paths) {
    NSString *report = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
    if (report.length > 1800000) {
      [self markHandled:@[ path ]];
      continue;
    }
    if (!report)
      continue;
    NSDictionary *body = @{
      @"report" : Scrubbed(report),
      @"process" : Header(path)[@"name"] ?: @"",
      @"version" : info[@"CFBundleShortVersionString"] ?: @"",
      @"build" : info[@"CFBundleVersion"] ?: @"",
      @"arch" : arch,
      @"os" : NSProcessInfo.processInfo.operatingSystemVersionString,
    };
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:endpoint];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 30;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    [[NSURLSession.sharedSession
        dataTaskWithRequest:request
          completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [(NSHTTPURLResponse *)response statusCode];
            // A report the server refuses outright will never be accepted.
            if (!error && (status == 200 || status == 400 || status == 413))
              dispatch_async(dispatch_get_main_queue(), ^{
                [self markHandled:@[ path ]];
              });
          }] resume];
  }
}

@end

#import <Foundation/Foundation.h>

// macOS writes a report to ~/Library/Logs/DiagnosticReports whenever Wing or
// one of its engine helpers crashes. These find Wing's new ones and, only with
// the person's consent, send them to Wing's crash endpoint.
@interface WingCrashReports : NSObject
// Reports newer than the first launch with crash reporting that have not
// been sent or dismissed yet, oldest first.
+ (NSArray<NSString *> *)pendingReports;
// Uploads them in the background; each is marked handled once it is sent.
+ (void)sendReports:(NSArray<NSString *> *)paths to:(NSURL *)endpoint;
// Forgets reports the person chose not to send.
+ (void)dismissReports:(NSArray<NSString *> *)paths;
@end

#import "ImportProcess.h"
@implementation WingImportProcess {
  NSTask *_task;
  NSPipe *_input, *_output;
  WingImportRequest _request;
  WingImportReply _completion;
  BOOL _finished;
}
- (void)finish:(id)result error:(NSString *)error {
  if (_finished)
    return;
  _finished = YES;
  [_input.fileHandleForWriting closeFile];
  if (_task.running)
    [_task terminate];
  WingImportReply completion = _completion;
  _completion = nil;
  _request = nil;
  if (completion)
    completion(result, error);
}
- (void)write:(NSDictionary *)message {
  NSData *json = [NSJSONSerialization dataWithJSONObject:message
                                                 options:0
                                                   error:nil];
  if (!json || json.length > 16000000) {
    [self finish:nil error:@"Import message exceeds the size limit."];
    return;
  }
  NSMutableData *body = [json mutableCopy];
  [body appendBytes:"\n" length:1];
  NSFileHandle *pipe = _input.fileHandleForWriting;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @try {
      [pipe writeData:body];
    } @catch (NSException *exception) {
      dispatch_async(dispatch_get_main_queue(), ^{
        [self finish:nil error:@"Import helper connection closed."];
      });
    }
  });
}
- (void)receive:(NSData *)line {
  if (_finished)
    return;
  id message = [NSJSONSerialization JSONObjectWithData:line
                                               options:0
                                                 error:nil];
  if (![message isKindOfClass:NSDictionary.class]) {
    [self finish:nil error:@"Invalid import response."];
    return;
  }
  if ([message[@"kind"] isEqual:@"result"]) {
    [self finish:message[@"result"] error:message[@"error"]];
    return;
  }
  if (![message[@"kind"] isEqual:@"request"] ||
      ![message[@"id"] isKindOfClass:NSNumber.class] ||
      ![message[@"operation"] isKindOfClass:NSString.class] ||
      ![message[@"data"] isKindOfClass:NSDictionary.class]) {
    [self finish:nil error:@"Invalid import request."];
    return;
  }
  _request(message, ^(id result, NSString *error) {
    if (self->_finished)
      return;
    [self write:error ? @{
      @"kind" : @"response",
      @"id" : message[@"id"],
      @"error" : error
    }
                      : @{
                          @"kind" : @"response",
                          @"id" : message[@"id"],
                          @"result" : result ?: NSNull.null
                        }];
  });
}
- (void)start:(NSDictionary *)input
       request:(WingImportRequest)request
    completion:(WingImportReply)completion {
  _request = [request copy];
  _completion = [completion copy];
  NSString *directory = [NSBundle.mainBundle.resourcePath
      stringByAppendingPathComponent:@"import-helper"];
  _task = [NSTask new];
  _task.executableURL = [NSURL
      fileURLWithPath:[directory stringByAppendingPathComponent:@"node"]];
  _task.arguments = @[ [directory
      stringByAppendingPathComponent:@"chromium-import-helper.cjs"] ];
  NSMutableDictionary *environment =
      [NSProcessInfo.processInfo.environment mutableCopy];
  [environment removeObjectForKey:@"NODE_OPTIONS"];
  [environment removeObjectForKey:@"NODE_PATH"];
  _task.environment = environment;
  _input = [NSPipe pipe];
  _output = [NSPipe pipe];
  _task.standardInput = _input;
  _task.standardOutput = _output;
  _task.standardError = [NSFileHandle fileHandleForWritingAtPath:@"/dev/null"];
  NSError *error;
  if (![_task launchAndReturnError:&error]) {
    [self finish:nil error:error.localizedDescription];
    return;
  }
  NSFileHandle *reader = _output.fileHandleForReading;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSMutableData *buffer = [NSMutableData new];
    NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    @try {
      while (YES) {
        NSData *chunk = [reader availableData];
        if (!chunk.length)
          break;
        [buffer appendData:chunk];
        if (buffer.length > 16000000)
          break;
        while (YES) {
          NSRange delimiter =
              [buffer rangeOfData:newline
                          options:0
                            range:NSMakeRange(0, buffer.length)];
          if (delimiter.location == NSNotFound)
            break;
          NSData *line =
              [buffer subdataWithRange:NSMakeRange(0, delimiter.location)];
          [buffer replaceBytesInRange:NSMakeRange(0, delimiter.location + 1)
                            withBytes:NULL
                               length:0];
          dispatch_async(dispatch_get_main_queue(), ^{
            [self receive:line];
          });
        }
      }
    } @catch (NSException *exception) {
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [self finish:nil error:@"Import helper stopped before completing."];
    });
  });
  [self write:input];
}
- (void)stop {
  [self finish:nil error:@"Import cancelled."];
}
@end

// wing-summarize: reads a page's text on stdin and prints a short summary made
// by Apple's on-device model. Nothing leaves the Mac. Exit 2 means the model is
// unavailable and stderr says why, in words Wing can show.
import Foundation
import FoundationModels

let model = SystemLanguageModel.default
switch model.availability {
case .available:
  break
case .unavailable(.deviceNotEligible):
  FileHandle.standardError.write(Data("This Mac can't run Apple Intelligence.".utf8))
  exit(2)
case .unavailable(.appleIntelligenceNotEnabled):
  FileHandle.standardError.write(
    Data("Turn on Apple Intelligence in System Settings to summarize pages.".utf8))
  exit(2)
case .unavailable(.modelNotReady):
  FileHandle.standardError.write(
    Data("Apple Intelligence is still downloading. Try again in a few minutes.".utf8))
  exit(2)
case .unavailable:
  FileHandle.standardError.write(Data("Apple Intelligence isn't available right now.".utf8))
  exit(2)
}

let input = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
// The on-device context window is small; the start of a page carries the gist.
let page = String(input.prefix(10000))
let session = LanguageModelSession(
  instructions: """
    You summarize web pages for the person reading them. Reply with 3 to 5 short \
    bullet points, each line starting with "• ", covering the main points in \
    plain language. No introduction, no headings, no markdown.
    """)
let done = DispatchSemaphore(value: 0)
Task {
  do {
    let response = try await session.respond(to: page)
    print(response.content.trimmingCharacters(in: .whitespacesAndNewlines))
  } catch LanguageModelSession.GenerationError.guardrailViolation {
    FileHandle.standardError.write(Data("This page can't be summarized.".utf8))
    exit(1)
  } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
    FileHandle.standardError.write(Data("This page is too long to summarize.".utf8))
    exit(1)
  } catch {
    FileHandle.standardError.write(Data("The page couldn't be summarized.".utf8))
    exit(1)
  }
  done.signal()
}
done.wait()

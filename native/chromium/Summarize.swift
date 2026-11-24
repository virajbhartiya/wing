// Reads page text on stdin for Wing's on-device summaries and translations.
import Foundation
import FoundationModels
import NaturalLanguage
import Translation

func translationError(_ message: String) -> Never {
  FileHandle.standardError.write(Data(message.utf8))
  exit(2)
}

func translatePage() async {
  let input = FileHandle.standardInput.readDataToEndOfFile()
  let text = String(decoding: input, as: UTF8.self)
  guard let detected = NLLanguageRecognizer.dominantLanguage(for: String(text.prefix(2_000))),
        let preferred = Locale.preferredLanguages.first else {
    translationError("Wing couldn’t identify the language on this page.")
  }
  let source = Locale.Language(identifier: detected.rawValue)
  let target = Locale.Language(identifier: preferred)
  if source.languageCode == target.languageCode,
     Locale.Language(identifier: source.maximalIdentifier).script ==
       Locale.Language(identifier: target.maximalIdentifier).script {
    translationError("This page is already in your preferred language.")
  }
  switch await LanguageAvailability().status(from: source, to: target) {
  case .installed:
    break
  case .supported:
    let locale = Locale.current
    let from = locale.localizedString(forIdentifier: source.minimalIdentifier) ?? source.minimalIdentifier
    let to = locale.localizedString(forIdentifier: target.minimalIdentifier) ?? target.minimalIdentifier
    translationError("Download \(from) and \(to) in System Settings → General → Language & Region → Translation Languages.")
  case .unsupported:
    translationError("macOS doesn’t support translation between these languages.")
  @unknown default:
    translationError("Translation isn’t available for this page.")
  }
  let session = TranslationSession(installedSource: source, target: target)
  let lines = text.split(whereSeparator: \.isNewline)
  var chunks: [String] = []
  for line in lines {
    var remainder = line.drop(while: \.isWhitespace)
    while remainder.count > 1_200 {
      let prefix = remainder.prefix(1_200)
      let boundary = prefix.lastIndex(where: \.isWhitespace) ?? prefix.endIndex
      chunks.append(String(remainder[..<boundary]))
      remainder = remainder[boundary...].drop(while: \.isWhitespace)
    }
    if !remainder.isEmpty { chunks.append(String(remainder)) }
  }
  do {
    let requests = chunks.map { TranslationSession.Request(sourceText: $0) }
    let results = try await session.translations(from: requests)
    guard results.count == chunks.count else {
      translationError("macOS returned an incomplete translation.")
    }
    print(results.map(\.targetText).joined(separator: "\n\n"))
  } catch {
    translationError("The page text couldn’t be translated. Check your installed languages and try again.")
  }
}

if CommandLine.arguments.dropFirst().first == "--translate" {
  alarm(30)
  await translatePage()
  exit(0)
}

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

import CryptoKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 4,
      let publicKeyBytes = Data(base64Encoded: arguments[2]),
      let signature = Data(base64Encoded: arguments[3]) else {
    fputs("Expected an archive path, a Base64 Ed25519 public key, and a Base64 signature.\n", stderr)
    exit(EXIT_FAILURE)
}

do {
    let key = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyBytes)
    let archive = try Data(contentsOf: URL(fileURLWithPath: arguments[1]), options: .mappedIfSafe)
    guard key.isValidSignature(signature, for: archive) else {
        fputs("The signature does not match the archive and configured public key.\n", stderr)
        exit(EXIT_FAILURE)
    }
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(EXIT_FAILURE)
}

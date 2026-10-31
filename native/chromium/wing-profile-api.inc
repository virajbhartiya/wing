- (void)flushCookiesWithCompletion:(void (^)(void))completion {
  if (!_profile) { completion(); return; }
  _profile->GetDefaultStoragePartition()->GetCookieManagerForBrowserProcess()->FlushCookieStore(
      base::BindOnce([](void (^done)(void)) { done(); }, completion));
}

- (void)importLogins:(NSArray<NSDictionary*>*)entries
         completion:(void (^)(NSInteger count, NSString* error))completion {
  if (!_profile || entries.count > 10000) { completion(0, @"Invalid password import."); return; }
  auto store = ProfilePasswordStoreFactory::GetForProfile(_profile.get(), ServiceAccessType::EXPLICIT_ACCESS);
  if (!store) { completion(0, @"The profile password store is unavailable."); return; }
  std::vector<password_manager::StoredCredential> credentials;
  for (NSDictionary* entry in entries) {
    if (![entry[@"url"] isKindOfClass:NSString.class] ||
        ![entry[@"username"] isKindOfClass:NSString.class] ||
        ![entry[@"password"] isKindOfClass:NSString.class]) continue;
    GURL address(base::SysNSStringToUTF8(entry[@"url"]));
    if (!address.is_valid() || !address.SchemeIsHTTPOrHTTPS() || ![entry[@"password"] length]) continue;
    password_manager::StoredCredential credential;
    credential.url = address.DeprecatedGetOriginAsURL();
    credential.signon_realm = credential.url.spec();
    credential.username_value = base::SysNSStringToUTF16(entry[@"username"]);
    credential.password_value = password_manager::PasswordString(base::SysNSStringToUTF16(entry[@"password"]));
    credential.date_created = base::Time::Now();
    credential.date_password_modified = credential.date_created;
    credentials.push_back(std::move(credential));
  }
  NSInteger count = credentials.size();
  store->AddLogins(std::move(credentials), base::BindOnce(
      [](decltype(store) password_store, NSInteger imported_count,
         void (^done)(NSInteger, NSString*)) {
        if (password_store->GetError() != password_manager::ActionableError::kNoError)
          done(0, @"Passwords could not be saved to the encrypted profile store.");
        else done(imported_count, nil);
      }, store, count, completion));
}

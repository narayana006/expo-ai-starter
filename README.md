# expo-ai-starter

Expo / React Native starter with streaming AI chat, voice input, secure backend proxy and App Store-ready defaults.

> **Project status: planning. There is no working code in this repository yet.**
> This README describes what the project will do. Nothing below can be installed or run today.
> Features are ticked off in the checklist as they are built.

## What it is

A app template.

**The problem it solves:** Mobile AI apps often ship API keys in the binary and get rejected by App Store review for avoidable reasons.

## Who it is for

Mobile developers starting an AI-powered iOS or Android app with Expo and React Native.

## How it will work

1. You create a new app from the template.
2. You deploy the small included backend, which holds your model key so it never ships inside the app.
3. You build and submit with EAS using the included configuration and review checklist.

## Planned features

Unticked items are not built yet.

- [ ] Streaming chat UI
- [ ] Voice input with speech-to-text
- [ ] Backend proxy so model keys never ship in the app
- [ ] Local caching of conversations
- [ ] App Store review checklist baked in (privacy manifest, account deletion, AI disclosure)
- [ ] EAS build and submit config

## Planned usage

This is the intended interface, shown so you can judge the design. **It does not work yet**, and names may change before the first release.

```bash
npx create-expo-app my-app --template https://github.com/narayana006/expo-ai-starter
```

## Contributing

Feedback on the design is the most useful contribution right now. Open an issue to suggest a feature, question an approach or describe your use case. Code contributions are welcome once the first version lands.

## License

[MIT](LICENSE)

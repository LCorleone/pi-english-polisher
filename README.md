# pi-english-polisher

A [pi](https://github.com/badlogic/pi-mono) extension that polishes your English input before sending it to the LLM.

## How it works

Prefix your input with `>` to trigger English polishing:

```
> i want to make a function that can process the data and return the result back
```

The extension will:

1. Take the current session's conversation context
2. Call the LLM to rewrite your input in natural, grammatically correct English
3. Show a before/after comparison
4. **Yes** → send the polished version
5. **No** → offer to edit the polished version
6. **Cancel** → send your original text

## Install

```bash
pi install git:github.com/LCorleone/pi-english-polisher
```

Or try without installing:

```bash
pi -e git:github.com/LCorleone/pi-english-polisher
```

## Usage

Just prefix any English input with `>`:

```
> this code is not working i dont know why the error say undefined is not a function
```

### What gets skipped

- Inputs without the `>` prefix — normal behavior, no interception
- Inputs containing Chinese characters — the `>` is stripped and the text passes through
- Inputs shorter than 3 characters after the prefix

## Configuration

No configuration needed. The extension uses your current session's model and API key.

## Uninstall

```bash
pi remove git:github.com/LCorleone/pi-english-polisher
```

## License

MIT

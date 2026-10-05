package memory

import "strings"

// chunk is a slice of a memory file with its 1-based line range.
type chunk struct {
	Text      string
	StartLine int
	EndLine   int
}

// chunkText splits text into overlapping chunks bounded by maxChars. Chunks are
// line-aligned and carry the line range so results can be read back precisely.
func chunkText(text string, maxChars, overlapChars int) []chunk {
	if maxChars <= 0 {
		maxChars = 2000
	}
	if overlapChars < 0 {
		overlapChars = 0
	}
	lines := strings.Split(text, "\n")
	if len(lines) == 0 {
		return nil
	}

	var chunks []chunk
	var current []string
	var currentLen int
	startLine := 1

	flush := func(endLine int) {
		if len(current) == 0 {
			return
		}
		joined := strings.TrimRight(strings.Join(current, "\n"), "\n")
		if strings.TrimSpace(joined) != "" {
			chunks = append(chunks, chunk{Text: joined, StartLine: startLine, EndLine: endLine})
		}
	}

	for i, line := range lines {
		lineLen := len(line) + 1
		if currentLen > 0 && currentLen+lineLen > maxChars {
			flush(i)
			// Build overlap from the tail of the finished chunk.
			overlap := tailLines(current, overlapChars)
			current = append([]string{}, overlap...)
			currentLen = 0
			for _, l := range current {
				currentLen += len(l) + 1
			}
			startLine = i + 1 - len(current)
			if startLine < 1 {
				startLine = 1
			}
		}
		current = append(current, line)
		currentLen += lineLen
	}
	flush(len(lines))
	return chunks
}

// tailLines returns the trailing lines whose total length fits targetChars.
func tailLines(lines []string, targetChars int) []string {
	if targetChars <= 0 {
		return nil
	}
	var out []string
	total := 0
	for i := len(lines) - 1; i >= 0; i-- {
		l := lines[i]
		if total+len(l)+1 > targetChars && len(out) > 0 {
			break
		}
		out = append([]string{l}, out...)
		total += len(l) + 1
	}
	return out
}

package config

import (
	"strconv"
	"strings"
)

// Preserve parseInt-style pagination inputs while bounding all SQL offsets.
func Page(value string) int {
	value = strings.TrimSpace(value)
	end := 0
	for i, r := range value {
		if (i == 0 && (r == '+' || r == '-')) || (r >= '0' && r <= '9') {
			end = i + 1
		} else {
			break
		}
	}
	n, e := strconv.ParseInt(value[:end], 10, 64)
	if e != nil {
		return 1
	}
	if n < 1 {
		return 1
	}
	if n > 10000 {
		return 10000
	}
	return int(n)
}

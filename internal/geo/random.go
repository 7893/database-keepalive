package geo

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
)

type Integer func(int, int) int

func Uniform(word func() uint32, min, max int) int {
	span := uint64(max - min + 1)
	if span < 1 || span > 1<<32 {
		panic("invalid random range")
	}
	ceiling := (uint64(1) << 32) / span * span
	for {
		n := uint64(word())
		if n < ceiling {
			return min + int(n%span)
		}
	}
}
func Random(min, max int) int {
	return Uniform(func() uint32 {
		var b [4]byte
		if _, e := rand.Read(b[:]); e != nil {
			panic("random source unavailable")
		}
		return binary.BigEndian.Uint32(b[:])
	}, min, max)
}
func Seeded(seed string) Integer {
	counter := 0
	return func(min, max int) int {
		return Uniform(func() uint32 {
			b, _ := json.Marshal([]any{seed, counter})
			counter++
			hash := sha256.Sum256(b)
			return binary.BigEndian.Uint32(hash[:4])
		}, min, max)
	}
}
func RequestID(execution, service string) string {
	h := sha256.Sum256([]byte(execution + ":" + service))
	s := fmt.Sprintf("%x", h)
	return s[:8] + "-" + s[8:12] + "-4" + s[13:16] + "-a" + s[17:20] + "-" + s[20:32]
}
func UUID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic("random source unavailable")
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

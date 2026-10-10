package random

import (
	"testing"
)

func TestRejectionSampling(t *testing.T) {
	calls := 0
	word := func() uint32 {
		calls++
		if calls == 1 {
			return ^uint32(0)
		}
		return 7
	}
	if n := Uniform(word, 1, 3); n != 2 || calls != 2 {
		t.Fatalf("modulo bias: result %d, calls %d", n, calls)
	}
	if n := Uniform(func() uint32 { return ^uint32(0) }, 0, 1); n != 1 {
		t.Fatal("inclusive bound lost")
	}
}

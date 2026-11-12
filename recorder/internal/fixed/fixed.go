// Package fixed parses venue decimal strings into exact int64 fixed-point values (scale 1e-8),
// so books compare and sort without floats. Venue tick sizes are at most 8 decimals.
package fixed

import (
	"errors"
	"strconv"
	"strings"
)

// Scale is the number of units per 1.0.
const Scale int64 = 100_000_000

const decimals = 8

var errSyntax = errors.New("fixed: invalid decimal")

// Parse converts "1740.0", "0.001" or "12" to units of 1e-8. Trailing zeros beyond 8 decimals
// are accepted; any other precision loss is an error.
func Parse(s string) (int64, error) {
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	intPart, frac, _ := strings.Cut(s, ".")
	if intPart == "" && frac == "" {
		return 0, errSyntax
	}
	if len(frac) > decimals {
		if strings.Trim(frac[decimals:], "0") != "" {
			return 0, errors.New("fixed: more than 8 decimals in " + s)
		}
		frac = frac[:decimals]
	}
	frac += strings.Repeat("0", decimals-len(frac))
	if intPart == "" {
		intPart = "0"
	}
	for _, c := range intPart + frac {
		if c < '0' || c > '9' {
			return 0, errSyntax
		}
	}
	v, err := strconv.ParseInt(intPart+frac, 10, 64)
	if err != nil {
		return 0, err
	}
	if neg {
		v = -v
	}
	return v, nil
}

// Format renders v without trailing zeros: 33000000 → "0.33", 174000000000 → "1740".
func Format(v int64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := strconv.FormatInt(v/Scale, 10)
	if f := v % Scale; f != 0 {
		fs := strconv.FormatInt(f+Scale, 10)[1:] // zero-padded to 8 digits
		s += "." + strings.TrimRight(fs, "0")
	}
	if neg {
		s = "-" + s
	}
	return s
}

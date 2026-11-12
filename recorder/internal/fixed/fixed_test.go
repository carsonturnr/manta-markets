package fixed

import "testing"

func TestParseFormat(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		out  string
	}{
		{"0.33", 33_000_000, "0.33"},
		{"0.330", 33_000_000, "0.33"},
		{"1740.0", 174_000_000_000, "1740"},
		{"12", 1_200_000_000, "12"},
		{".5", 50_000_000, "0.5"},
		{"0.00000001", 1, "0.00000001"},
		{"0.1234567800", 12_345_678, "0.12345678"},
		{"-0.00004289", -4289, "-0.00004289"},
	}
	for _, c := range cases {
		got, err := Parse(c.in)
		if err != nil || got != c.want {
			t.Errorf("Parse(%q) = %d, %v; want %d", c.in, got, err, c.want)
			continue
		}
		if f := Format(got); f != c.out {
			t.Errorf("Format(%d) = %q; want %q", got, f, c.out)
		}
	}
}

func TestParseRejects(t *testing.T) {
	for _, in := range []string{"", ".", "1e5", "0.123456789", "-0.0000428906", "abc", "1.2.3"} {
		if _, err := Parse(in); err == nil {
			t.Errorf("Parse(%q) accepted", in)
		}
	}
}

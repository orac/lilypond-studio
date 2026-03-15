\version "2.24.0"

\header {
  title = "Test Score"
  composer = "Test"
}

melody = \relative c'' {
  \time 4/4
  \key g \major
  \clef treble

  g4 a b c |
  d2 d |
  e4 e e e |
  d1 |

  c4 c c c |
  b2 b |
  a4 a a a |
  g1 |
}

\score {
  \new Staff \melody
  \layout { }
  \midi { }
}

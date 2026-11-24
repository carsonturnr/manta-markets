// Manta's mark as text: components/Mark.tsx's outline rasterised to a 60 x 19 grid of characters,
// denser characters where more of the cell is inside the shape. Decoration only.
const ART = `
                             --
                            -@@-
                          :*@@@@*:
                        -#@@@@@@@@#-
                    .-*@@@@@@@@@@@@@@*-.
                 .=#@@@@@@@@@@@@@@@@@@@@#=.
              :+%@@@@@@@@@@@@@@@@@@@@@@@@@@%+:
           :+%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%+:
         -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#-
       -%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%-
     .#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#.
    -@@@@@@@@@%#+-:..   .-#@@@@@@#-.   ..:-+#%@@@@@@@@@-
   =@@@@@@@#=.             +@@@@+             .=#@@@@@@@=
  -@@@@@%=.                 *@@*                 .=%@@@@@-
 .@@@@#-                     %@                     -#@@@@.
 +@@%-                       ++                       -%@@+
 %@#                         ..                         #@%
.@+                                                      +@.
 :                                                        :
`;

export default function MantaAscii() {
  return (
    <pre className="ascii" aria-hidden="true">
      {ART.slice(1, -1)}
    </pre>
  );
}

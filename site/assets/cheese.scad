// SCAD AI IDE website demo — precompiled to cheese.stl for the browser.
// Browser preview loads the STL; it does not execute OpenSCAD code.
$fn = 28;

module wedge() {
  polyhedron(
    points = [
      [-34, -27, 0], [38, -27, 0], [-34, 29, 0],
      [-34, -27, 36], [38, -27, 7], [-34, 29, 36]
    ],
    faces = [
      [0, 2, 1], [3, 4, 5],
      [0, 1, 4], [0, 4, 3],
      [1, 2, 5], [1, 5, 4],
      [2, 0, 3], [2, 3, 5]
    ]
  );
}

difference() {
  wedge();
  translate([-19, -29, 14]) sphere(r = 9);
  translate([13, -29, 11]) sphere(r = 5.6);
  translate([-5, -28, 25]) sphere(r = 4);
  translate([-36, 11, 14]) sphere(r = 8);
  translate([-35, -14, 29]) sphere(r = 4.3);
  translate([-20, 0, 37]) sphere(r = 8.5);
  translate([7, -10, 22]) sphere(r = 5);
}

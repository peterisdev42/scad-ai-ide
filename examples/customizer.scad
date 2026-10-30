/* [Global] */
// Resolution shared by every section.
resolution = 32; // [8:8:96]

/* [Geometry] */
// Width in millimeters.
// Drag the slider or enter a number.
width = 40; // [10:5:100]
// Height with a maximum-only slider.
height = 20; // [100]
// Wall thickness, adjusted in half-millimeter steps.
wall = 2.5; // .5
// X, Y, Z dimensions of the model.
size = [10, 20, 30]; // [0:5:100]
// Four-component vector.
rotation = [0, 0, 1, 45]; // [-180:1:180]

/* [Appearance] */
// Select a shape.
shape = "round"; // [round:Round, square:Square]
// Select a numeric quality level.
quality = 2; // [1:Draft, 2:Normal, 3:Fine]
// Enable a hollow model.
hollow = true;
// Label text, at most 20 characters.
label = "Model"; // 20

/* [Hidden] */
internal_offset = 0.01;

$fn = resolution;
if (shape == "round") {
    cylinder(d = width, h = height);
} else {
    cube([width, width, height]);
}

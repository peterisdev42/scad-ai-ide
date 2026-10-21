// Parametric bracket — syntax highlighting sample
$fn = 72;
width = 40;
wall = 2.5;
enabled = true;

function clamp01(value) = min(1, max(0, value));

module bracket(size = [width, 24, 12], thickness = wall) {
    difference() {
        cube(size, center = true);
        translate([0, 0, thickness])
            cube([size[0] - 2 * thickness, size[1], size[2]], center = true);
    }
}

if (enabled)
    color("steelblue") bracket();

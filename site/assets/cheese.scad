// Stylized cheese wedge, based on temp/cheese.svg, temp/scad.svg
// and temp/icon.png. Dimensions are in millimeters.
// Open directly in OpenSCAD; no external libraries or image imports needed.

/* [Size] */
// Length from the pointed end to the heel (mm).
length = 90;
// Width of the heel (mm).
width = 52;
// Thickness of the cheese slice (mm).
height = 32;

/* [Style] */
// Radius of the soft outer edges (mm).
edge_radius = 1.2; // [0:0.1:3]
// Scale all six cavities while keeping their icon-inspired layout.
hole_scale = 1; // [0.7:0.05:1.15]
// Show the sculpted cheese holes.
show_holes = true;
// Golden yellow used for the preview.
cheese_color = "#FFD52A";

/* [Quality] */
// Number of segments on curved surfaces.
detail = 72; // [24:12:120]

/* [Hidden] */
$fn = detail;

// The broad display face is y = -width/2. The point faces -X.
// Offset the triangular core inward, then round it outward with a sphere.
// This keeps the bottom and top flat, with a small tessellation tolerance.
module wedge_body(l, w, h, r) {
    if (r > 0) {
        minkowski() {
            translate([0, 0, r])
                linear_extrude(height = h - 2*r, convexity = 4)
                    offset(delta = -r)
                        polygon([[0, -w/2], [l, -w/2], [l, w/2]]);
            sphere(r = r, $fn = 32);
        }
    } else {
        linear_extrude(height = h, convexity = 4)
            polygon([[0, -w/2], [l, -w/2], [l, w/2]]);
    }
}

// Ellipsoid cutters form rounded bowls with curved interiors.
// Centers sit just outside each face to make clean, open cavity mouths.
module cavity(position, radii, factor = 1) {
    translate(position)
        scale(radii * factor)
            sphere(r = 1);
}

// Reference layout at 90 x 52 x 32 mm: two top holes, four face holes.
// Normalize the cutters so their positions track changes in body size.
module cheese_cavities(l, w, h, factor) {
    scale([l/90, w/52, h/32]) {
        // Top: one generous oval bowl and a smaller near-tip dimple.
        cavity([65, -3, 33.5], [12, 10.5, 11], factor);
        cavity([32, -15, 32.8], [4.8, 4.5, 4], factor);

        // Broad side: the large central eye and three smaller accents.
        cavity([61, -27, 16.5], [11.5, 12, 12.7], factor);
        cavity([23, -27, 11.5], [7.8, 9, 8.5], factor);
        cavity([41, -26.7, 6.8], [3.5, 4, 3.8], factor);
        cavity([81, -26.8, 24.5], [4.2, 5, 4.8], factor);
    }
}

module cheese(l = length, w = width, h = height,
              r = edge_radius, cavities = show_holes,
              cavity_scale = hole_scale) {
    assert(l > 0 && w > 0 && h > 0, "Dimensions must be positive.");
    assert(r >= 0 && r < min(l, w, h)/6,
           "Edge radius is too large for this wedge.");
    assert(cavity_scale >= 0.7 && cavity_scale <= 1.15,
           "Hole scale must be between 0.7 and 1.15.");
    translate([-l/2, 0, 0])
        difference() {
            wedge_body(l, w, h, r);
            if (cavities)
                cheese_cavities(l, w, h, cavity_scale);
        }
}

color(cheese_color)
    cheese();

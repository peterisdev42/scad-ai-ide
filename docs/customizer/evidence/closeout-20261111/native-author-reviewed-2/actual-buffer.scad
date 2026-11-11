/* [Dimensions] */
// Width in millimeters
width=40; // [10:5:100]
/* [Appearance] */
// Select shape
shape="round"; // ["round":"Round", "square":"Square"]
/* [Hidden] */
internalOffset=0.01;
module model() { cube([width,2,3]); }
model();

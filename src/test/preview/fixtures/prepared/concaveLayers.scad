difference() {
    render(convexity=6) difference() {
        cube([24,24,24],center=true);
        cylinder(h=30,r=6,center=true,$fn=24);
    }
    translate([8,0,0]) cube([8,8,30],center=true);
}

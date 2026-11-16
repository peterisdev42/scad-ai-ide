part="body";
hole=3;
if(part=="body") difference(){cube([20,20,5]);translate([10,10,-1])cylinder(h=7,r=hole,$fn=32);}
else if(part=="shell")translate([30,0,0])cube([10,10,5]);

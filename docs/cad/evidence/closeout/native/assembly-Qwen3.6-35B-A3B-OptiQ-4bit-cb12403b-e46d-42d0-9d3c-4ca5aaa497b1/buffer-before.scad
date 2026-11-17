part="body";
gap=0.18;
if(part=="body") difference(){cube([20,20,10]);translate([1,1,1])cube([18,18,10]);}
else if(part=="lid") translate([0,0,10+gap])cube([20,20,1]);

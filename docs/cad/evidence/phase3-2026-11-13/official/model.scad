include <PartLib/main.scad>
part="body";gap=0.18;
if(part=="body")body();else if(part=="lid")lid(gap);

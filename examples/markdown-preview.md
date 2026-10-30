# OpenSCAD Markdown preview

Open this file in VS Code's built-in Markdown preview with a selected OpenSCAD runtime.
Both language tags default to a rendered preview, with Preview / Source tabs to switch views.
Previews keep a 4:3 aspect ratio up to 800 × 600 pixels and shrink in narrow windows.

## openscad

```openscad
cube(20);
```

## scad

```scad
cube(20);
```

## Boolean geometry

```openscad
difference() {
    cube([30, 30, 20], center = true);
    cylinder(h = 30, r = 10, center = true, $fn = 64);
}
```

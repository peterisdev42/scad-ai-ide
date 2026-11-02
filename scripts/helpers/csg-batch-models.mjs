export function overlappingBoxes(count, operation = 'union', size = [30, 30, 30]) {
    return `${operation}(){${Array.from({ length: count }, (_, i) => {
        const x = ((i % 8) - 3.5) * 0.5,
            y = ((Math.floor(i / 8) % 8) - 3.5) * 0.5,
            z = (Math.floor(i / 64) - 1) * 0.5
        return `multmatrix([[1,0,0,${x}],[0,1,0,${y}],[0,0,1,${z}],[0,0,0,1]])cube(size=${JSON.stringify(size)},center=true);`
    }).join('')}}`
}
export const overlapUnion = overlappingBoxes(192)
export const negativeUnion = `difference(){cube(size=[30,30,30],center=true);${overlappingBoxes(12, 'intersection', [12, 60, 12])}}`
export const mixedDifference = `difference(){cube(size=[30,30,30],center=true);union(){${Array.from({ length: 12 }, (_, i) => `multmatrix([[1,0,0,${((i % 4) - 1.5) * 0.5}],[0,1,0,0],[0,0,1,${(Math.floor(i / 4) - 1) * 0.5}],[0,0,0,1]])multmatrix([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]])cylinder(h=40,r=5,center=true,$fn=24);`).join('')}}}`
export const nonconvexUnion = `union(){${Array.from({ length: 12 }, (_, i) => `multmatrix([[1,0,0,${(i - 5.5) * 0.25}],[0,1,0,0],[0,0,1,0],[0,0,0,1]])render()difference(){cube(size=[30,30,30],center=true);cube(size=[10,40,10],center=true);}`).join('')}}`

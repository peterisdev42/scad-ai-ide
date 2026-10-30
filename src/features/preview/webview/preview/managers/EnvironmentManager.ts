import { BufferGeometry, GridHelper, Group, Mesh, MeshBasicMaterial } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { BuildPlateOrigin, Environment } from '../../contexts/ViewOptionsContext'
import buildPlate from '../assets/models/buildPlate.stl'
import { Theme } from '../Stage'
import { InfiniteGrid } from '../widgets/InfiniteGrid'
import { BUILD_PLATE_SIZE, buildPlateOffset } from './BuildPlateLayout'

export class EnvironmentManager {
    public group: Group
    private infiniteGrid?: InfiniteGrid
    private plateOrigin = BuildPlateOrigin.Center
    private buildPlate?: {
        mesh: Mesh<BufferGeometry, MeshBasicMaterial>
        grid: GridHelper
    }

    constructor(
        private environment: Environment,
        private theme: Theme,
    ) {
        this.group = new Group()
        this.group.name = 'EnvironmentManager'
        this.redraw()
    }

    public setTheme(theme: Theme) {
        this.theme = theme
        this.infiniteGrid?.setTheme(theme)
        if (this.buildPlate) {
            this.buildPlate.mesh.material.color.copy(theme.plate)
            const colors = this.buildPlate.grid.geometry.getAttribute('color')
            for (let index = 0; index < colors.count; index++) {
                colors.setXYZ(index, theme.plateGrid.r, theme.plateGrid.g, theme.plateGrid.b)
            }
            colors.needsUpdate = true
        }
    }

    public setEnvironment(environment: Environment, plateOrigin = BuildPlateOrigin.Center) {
        if (this.environment === environment && this.plateOrigin === plateOrigin) return
        this.environment = environment
        this.plateOrigin = plateOrigin
        this.redraw()
    }

    /** Call every animation frame so the grid fades with the camera. */
    public updateCamera(orbitDistance: number) {
        this.infiniteGrid?.update(orbitDistance)
    }

    private redraw() {
        if (this.infiniteGrid) {
            this.group.remove(this.infiniteGrid.mesh)
            this.infiniteGrid.dispose()
            this.infiniteGrid = undefined
        }

        if (this.buildPlate) {
            this.group.remove(this.buildPlate.mesh)
            this.group.remove(this.buildPlate.grid)
            this.buildPlate.mesh.geometry.dispose()
            this.buildPlate.mesh.material.dispose()
            this.buildPlate.grid.geometry.dispose()
            this.buildPlate.grid.material.dispose()
            this.buildPlate = undefined
        }

        if (this.environment === Environment.Grid) {
            this.infiniteGrid = new InfiniteGrid(this.theme)
            this.group.add(this.infiniteGrid.mesh)
        } else if (this.environment === Environment.BuildPlate) {
            this.buildPlate = this.initBuildPlate()
        }
    }

    private initBuildPlate() {
        const loader = new STLLoader()
        const geometry = loader.parse(buildPlate.buffer as ArrayBuffer)

        const material = new MeshBasicMaterial({
            color: this.theme.plate,
            depthTest: false,
            depthWrite: false,
            fog: false,
            toneMapped: false,
        })

        const mesh = new Mesh(geometry, material)
        mesh.renderOrder = -1
        this.group.add(mesh)

        const grid = new GridHelper(BUILD_PLATE_SIZE, 25, this.theme.plateGrid, this.theme.plateGrid)
        grid.renderOrder = -1
        grid.rotateX(Math.PI / 2)
        grid.material.depthTest = false
        grid.material.depthWrite = false
        grid.material.fog = false
        this.group.add(grid)
        const offset = buildPlateOffset(this.plateOrigin)
        mesh.position.copy(offset)
        grid.position.copy(offset)

        return { mesh, grid }
    }
}

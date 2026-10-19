import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function canvasPoint(page: Page, x: number, y: number) {
  await expect.poll(() => page.locator('#map-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ratio = Math.min(devicePixelRatio, 2);
    return canvas.clientWidth > 90 && canvas.clientHeight > 90
      && Math.abs(canvas.width / ratio - canvas.clientWidth) <= 2
      && Math.abs(canvas.height / ratio - canvas.clientHeight) <= 2;
  })).toBe(true);
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Spline canvas is missing.');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  const point = await canvasPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

test('independent points can form chained, closed, and branching connections', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/map-builder/');
  await expect(page.getByRole('heading', { name: 'Spline Map Builder' })).toBeVisible();
  await expect(page.locator('#spline-summary')).toHaveText('0 points · 0 connections');

  await clickCanvas(page, .2, .25);
  await clickCanvas(page, .249, .25);
  await expect(page.locator('#spline-summary')).toHaveText('1 point · 0 connections');
  for (const [x, y] of [[.75, .25], [.72, .75], [.25, .72], [.5, .5]] as const) await clickCanvas(page, x, y);
  await expect(page.locator('#spline-summary')).toHaveText('5 points · 0 connections');

  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await clickCanvas(page, .2, .25);
  await expect(page.locator('#selection-summary')).toHaveText('Connecting from point 1');
  await clickCanvas(page, .75, .25);
  await clickCanvas(page, .72, .75);
  await clickCanvas(page, .5, .1);
  await expect(page.locator('#selection-summary')).toHaveText('Nothing selected');
  await expect(page.locator('#spline-summary')).toHaveText('5 points · 2 connections');
  await clickCanvas(page, .75, .25);
  await clickCanvas(page, .25, .72);
  await clickCanvas(page, .2, .25);
  await expect(page.locator('#spline-summary')).toHaveText('5 points · 4 connections');

  await clickCanvas(page, .5, .1);
  await clickCanvas(page, .75, .25);
  await clickCanvas(page, .5, .5);
  await expect(page.locator('#spline-summary')).toHaveText('5 points · 5 connections');
  const graph = await page.evaluate(() => (window as any).splineBuilder.graph);
  expect(graph.connections.filter((connection: { startNodeId: number; endNodeId: number }) => (
    connection.startNodeId === 2 || connection.endNodeId === 2
  ))).toHaveLength(4);
  await page.getByRole('button', { name: 'Set heights', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).splineBuilder.getPreviewDiagnostics().vertices > 0)).toBe(true);
  expect(errors).toEqual([]);
});
test('moved points slide around neighbors and every connection has editable handles', async ({ page }) => {
  await page.goto('/map-builder/');
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .5, .25);
  await clickCanvas(page, .8, .5);
  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .5, .25);
  await clickCanvas(page, .8, .5);
  await page.getByRole('button', { name: 'Edit curves', exact: true }).click();

  const middle = await canvasPoint(page, .5, .25);
  const requested = await canvasPoint(page, .22, .5);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(requested.x, requested.y);
  await page.mouse.up();
  const positions = await page.evaluate(() => (window as any).splineBuilder.graph.nodes.map((node: any) => node.position));
  const separation = Math.hypot(positions[1].x - positions[0].x, positions[1].y - positions[0].y);
  expect(separation).toBeCloseTo(.05, 4);
  expect(positions[1].x).not.toBeCloseTo(.5, 2);
  await expect(page.locator('#builder-message')).toContainText('Sliding');

  await expect(page.locator('#selection-summary')).toHaveText('Point 2 selected');
  await expect(page.locator('#handle-options')).toBeVisible();
  await page.getByRole('button', { name: 'Symmetric', exact: true }).click();
  const data = await page.evaluate(() => {
    const graph = (window as any).splineBuilder.graph;
    const connection = graph.connections[1];
    const start = graph.nodes.find((node: any) => node.id === connection.startNodeId);
    return { connection, start };
  });
  const handle = await canvasPoint(page,
    data.start.position.x + data.connection.startHandle.x,
    data.start.position.y + data.connection.startHandle.y);
  const destination = await canvasPoint(page, .55, .72);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y);
  await page.mouse.up();
  const changed = await page.evaluate(() => (window as any).splineBuilder.graph.connections[1].startHandle);
  expect(changed.y).toBeGreaterThan(.1);
  const paired = await page.evaluate(() => (window as any).splineBuilder.graph.connections[0].endHandle);
  expect(paired.x).toBeCloseTo(-changed.x, 5);
  expect(paired.y).toBeCloseTo(-changed.y, 5);

  await page.getByRole('button', { name: 'Delete selected point' }).click();
  await expect(page.locator('#spline-summary')).toHaveText('2 points · 0 connections');
});

test('default and per-point widths produce inherited and custom road widths', async ({ page }) => {
  await page.goto('/map-builder/');
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .8, .5);
  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .8, .5);

  await page.getByRole('button', { name: 'Set widths', exact: true }).click();
  await page.locator('#default-width').fill('16');
  expect(await page.evaluate(() => (window as any).splineBuilder.graph.nodes.map((node: any) => node.width))).toEqual([16, 16]);

  await clickCanvas(page, .2, .5);
  await expect(page.locator('#point-width-options')).toBeVisible();
  await page.locator('#point-width').fill('24');
  await page.locator('#default-width').fill('20');
  expect(await page.evaluate(() => (window as any).splineBuilder.graph.nodes.map((node: any) => node.width))).toEqual([24, 20]);
  await expect(page.locator('#point-width-value')).toHaveText('24.0 m');

  await page.getByRole('button', { name: 'Use default width' }).click();
  expect(await page.evaluate(() => (window as any).splineBuilder.graph.nodes[0].width)).toBe(20);
});

test('point height and steepness shape the continuous orbitable 3D road', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/map-builder/');
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .5, .3);
  await clickCanvas(page, .8, .5);
  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .5, .3);
  await clickCanvas(page, .8, .5);

  await page.getByRole('button', { name: 'Set heights', exact: true }).click();
  await expect(page.locator('#preview-panel')).toBeVisible();
  const workspaceBox = await page.locator('#visual-workspace').boundingBox();
  const previewBox = await page.locator('#preview-panel').boundingBox();
  const insetBox = await page.locator('.canvas-panel').boundingBox();
  expect(workspaceBox && previewBox && insetBox).toBeTruthy();
  expect(previewBox!.width).toBeCloseTo(workspaceBox!.width, 0);
  expect(previewBox!.height).toBeCloseTo(workspaceBox!.height, 0);
  expect(insetBox!.width).toBeCloseTo(180, 0);
  expect(insetBox!.height).toBeCloseTo(180, 0);
  expect(insetBox!.x - workspaceBox!.x).toBeCloseTo(16, 0);
  expect(workspaceBox!.y + workspaceBox!.height - insetBox!.y - insetBox!.height).toBeCloseTo(16, 0);
  const targetBeforePan = await page.evaluate(() => (window as any).splineBuilder.getPreviewDiagnostics().orbitTarget);
  const previewCanvasBox = await page.locator('#preview-canvas').boundingBox();
  if (!previewCanvasBox) throw new Error('Preview canvas is missing.');
  await page.mouse.move(previewCanvasBox.x + previewCanvasBox.width * .65, previewCanvasBox.y + previewCanvasBox.height * .55);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(previewCanvasBox.x + previewCanvasBox.width * .75, previewCanvasBox.y + previewCanvasBox.height * .65);
  await page.mouse.up({ button: 'right' });
  const targetAfterPan = await page.evaluate(() => (window as any).splineBuilder.getPreviewDiagnostics().orbitTarget);
  expect(targetAfterPan).toEqual(targetBeforePan);
  await clickCanvas(page, .5, .3);
  await expect(page.locator('#point-height-options')).toBeVisible();
  await page.locator('#point-height').fill('25');
  await page.locator('#point-steepness').fill('80');
  await expect(page.locator('#point-height-value')).toHaveText('25.0 m');
  await expect(page.locator('#point-steepness-value')).toHaveText('80%');
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = (window as any).splineBuilder.getPreviewDiagnostics();
    return diagnostics.vertices > 0 && diagnostics.markers === 3
      && diagnostics.selectedMarkers === 1 && diagnostics.topSurfaceHeightRange > 20
      && diagnostics.thickness > 0 && diagnostics.polygons === 1
      && diagnostics.maximumTopTriangleEdge <= 6.001;
  })).toBe(true);
  expect(await page.evaluate(() => {
    const node = (window as any).splineBuilder.graph.nodes[1];
    return { height: node.height, steepness: node.heightSteepness };
  })).toEqual({ height: 25, steepness: 80 });

  await page.getByRole('button', { name: 'Set widths', exact: true }).click();
  await expect(page.locator('#preview-panel')).toBeHidden();
  expect(errors).toEqual([]);
});

test('finish setup previews ten grid slots and limits optional checkpoints to three', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/map-builder/');
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .8, .5);
  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await clickCanvas(page, .2, .5);
  await clickCanvas(page, .8, .5);

  await page.getByRole('button', { name: 'Set finish line', exact: true }).click();
  await expect(page.locator('#preview-panel')).toBeHidden();
  await clickCanvas(page, .21, .5);
  await expect(page.locator('#builder-message')).toContainText('Cannot place the finish line that close to a point');
  expect(await page.evaluate(() => (window as any).splineBuilder.graph.finishLine)).toBeNull();
  await clickCanvas(page, .5, .5);
  await expect(page.locator('#finish-status')).toContainText('connection 1');
  const grid = await page.evaluate(() => (window as any).splineBuilder.getStartGrid());
  expect(grid).toHaveLength(10);
  expect([...new Set(grid.map((slot: { row: number }) => slot.row))]).toEqual([0, 1, 2, 3, 4]);
  expect(grid.filter((slot: { row: number }) => slot.row === 0)).toHaveLength(2);
  expect(grid.every((slot: { position: { x: number }; direction: { x: number } }) => (
    slot.position.x < .5 && slot.direction.x > 0
  ))).toBe(true);

  await page.getByRole('button', { name: 'Flip direction' }).click();
  await expect(page.locator('#finish-status')).toContainText('Reversed');
  const reversedGrid = await page.evaluate(() => (window as any).splineBuilder.getStartGrid());
  expect(reversedGrid.every((slot: { position: { x: number }; direction: { x: number } }) => (
    slot.position.x > .5 && slot.direction.x < 0
  ))).toBe(true);

  await page.getByRole('button', { name: 'Set heights', exact: true }).click();
  await expect(page.locator('#preview-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as any).splineBuilder.getPreviewDiagnostics().finishMarkerMeshes
  ))).toBe(27);
  await page.getByRole('button', { name: 'Set finish line', exact: true }).click();

  await page.getByRole('button', { name: 'Add checkpoint', exact: true }).click();
  await clickCanvas(page, .3, .5);
  await clickCanvas(page, .4, .5);
  await clickCanvas(page, .6, .5);
  await expect(page.locator('#checkpoint-count')).toHaveText('3 / 3');
  await expect(page.getByRole('button', { name: 'Add checkpoint', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).splineBuilder.graph.checkpoints)).toHaveLength(3);

  await page.getByRole('button', { name: 'Set heights', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = (window as any).splineBuilder.getPreviewDiagnostics();
    const editorDiagnostics = (window as any).splineBuilder.getEditorDiagnostics();
    return diagnostics.finishMarkerMeshes === 27 && diagnostics.checkpointMarkerMeshes === 36
      && editorDiagnostics.drawnInsetCheckpointMarkers === 0;
  })).toBe(true);
  await page.getByRole('button', { name: 'Set finish line', exact: true }).click();

  await page.getByRole('button', { name: 'Remove checkpoint' }).nth(1).click();
  await expect(page.locator('#checkpoint-count')).toHaveText('2 / 3');
  await expect(page.getByRole('button', { name: 'Add checkpoint', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Clear finish line' }).click();
  expect(await page.evaluate(() => (window as any).splineBuilder.graph.finishLine)).toBeNull();
  expect(errors).toEqual([]);
});

test('the graph editor remains usable at desktop, short, and phone sizes', async ({ page }) => {
  await page.goto('/map-builder/');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 900, height: 500 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.locator('#map-canvas').evaluate((canvas: HTMLCanvasElement) => (
      canvas.clientWidth > 250 && canvas.clientHeight > 250
    ))).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await clickCanvas(page, .3, .3);
  await clickCanvas(page, .7, .7);
  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await clickCanvas(page, .3, .3);
  await clickCanvas(page, .7, .7);
  await expect(page.locator('#spline-summary')).toHaveText('2 points · 1 connection');
});

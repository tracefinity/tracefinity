use crate::profile::{Point, Rings};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Job {
    pub size: Point,
    pub wall_top: f64,
    pub rim: f64,
    pub lip: bool,
    pub blank_floor: Option<f64>,
    pub wall: f64,
    pub allow_wall_cutouts: bool,
    pub feet: Vec<Foot>,
    pub magnet: [f64; 2],
    pub trim: Vec<Extrusion>,
    pub bridges: Vec<Rect>,
    pub pockets: Vec<Pocket>,
    pub fingers: Vec<Finger>,
    pub recessed: Vec<Extrusion>,
    pub embossed: Vec<Extrusion>,
    pub inserts: Vec<Extrusion>,
    pub splits: [Vec<f64>; 2],
    pub separate: bool,
}

#[derive(Deserialize)]
pub struct Rect {
    pub at: Point,
    pub size: Point,
    pub radius: f64,
}

#[derive(Deserialize)]
pub struct Foot {
    pub at: Point,
    pub size: Point,
    pub magnets: Vec<Point>,
}

#[derive(Deserialize)]
pub struct Extrusion {
    pub rings: Rings,
    pub low: f64,
    pub high: f64,
}

#[derive(Deserialize)]
pub struct Pocket {
    pub rings: Rings,
    pub floor: f64,
    pub fit: f64,
    pub chamfer: f64,
    pub center: Point,
    pub scale: Point,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FingerShape {
    Circle,
    Cylinder,
    Square,
    Rectangle,
    FilletedRectangle,
}

#[derive(Deserialize)]
pub struct Finger {
    pub at: Point,
    pub floor: f64,
    pub radius: f64,
    pub size: Point,
    pub angle: f64,
    pub round: f64,
    pub chamfer: f64,
    pub shape: FingerShape,
}

impl Finger {
    pub fn round_angle_for_retry(&mut self) -> bool {
        if matches!(self.shape, FingerShape::Circle | FingerShape::Cylinder) {
            return false;
        }
        let rounded = (self.angle * 1000.).round() / 1000.;
        let delta = (rounded - self.angle).abs();
        let [x, y] = self.size.map(|side| side / 2. + self.chamfer);
        let corner_radius = x.hypot(y);
        if delta > 0. && corner_radius * delta.to_radians() <= 0.001 {
            self.angle = rounded;
            return true;
        }
        false
    }
}

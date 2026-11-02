// Adapted from OpenSCAD fe482c342ea48bbe749563315741d0e58cdfd57f, geometry/roof_vd.cc.
// Original author: Alexey Korepanov. SPDX-License-Identifier: GPL-2.0-or-later
#include <boost/polygon/voronoi.hpp>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <vector>
#include <sstream>
#include <iomanip>
#include <stdexcept>
#include <ostream>
struct Vector2d {
 double a{},b{};
 Vector2d()=default; Vector2d(double x,double y):a(x),b(y){}
 double operator[](int i)const{return i?b:a;}
 double x()const{return a;} double y()const{return b;}
 double norm()const{return std::hypot(a,b);}
 void normalize(){const double n=norm();a/=n;b/=n;}
 Vector2d normalized()const{auto v=*this;v.normalize();return v;}
 double dot(const Vector2d& v)const{return a*v.a+b*v.b;}
 Vector2d operator+(const Vector2d& v)const{return {a+v.a,b+v.b};}
 Vector2d operator-(const Vector2d& v)const{return {a-v.a,b-v.b};}
 Vector2d operator*(double s)const{return {a*s,b*s};}
 Vector2d operator/(double s)const{return {a/s,b/s};}
};
struct RoofDiscretizer {
 double angle,length;
 RoofDiscretizer(double fn,double fa,double fs,double scale):angle(M_PI/180*(fn>0?360/fn:std::max(fa,0.01))/2),length(fn>0?0:fs*fs*scale*scale){}
 bool overMaxAngle(double a)const{return a>angle;}
 bool hasMaxSegmentSqrLength()const{return length>0;}
 bool overMaxSegmentSqrLength(double s)const{return s>length;}
};
#define RAISE_ROOF_EXCEPTION(message) throw std::runtime_error(message)
#define SAFE_VERTEX_MSG(edge,numeral,msg) ((edge)->vertex##numeral()==nullptr?(throw std::runtime_error(msg),nullptr):(edge)->vertex##numeral())
#define SAFE_VERTEX(edge,numeral) SAFE_VERTEX_MSG(edge,numeral,"Roof Voronoi has an unbounded interior edge.")
namespace roof_vd {

using VD_int = int32_t;

using voronoi_diagram = ::boost::polygon::voronoi_diagram<double>;

struct Point {
  VD_int a;
  VD_int b;
  Point(VD_int x, VD_int y) : a(x), b(y) {}
  friend std::ostream& operator<<(std::ostream& os, const Point& point)
  {
    return os << "(" << point.a << ", " << point.b << ")";
  }
};

struct Segment {
  Point p0;
  Point p1;
  Segment(VD_int x1, VD_int y1, VD_int x2, VD_int y2) : p0(x1, y1), p1(x2, y2) {}
  friend std::ostream& operator<<(std::ostream& os, const Segment& segment)
  {
    return os << segment.p0 << " -- " << segment.p1;
  }
};

}  // namespace roof_vd

// pass our Point and Segment structures to boost::polygon
namespace boost::polygon {
template <>
struct geometry_concept<roof_vd::Point> {
  using type = point_concept;
};
template <>
struct point_traits<roof_vd::Point> {
  using coordinate_type = roof_vd::VD_int;

  static inline coordinate_type get(const roof_vd::Point& point, const orientation_2d& orient)
  {
    return (orient == HORIZONTAL) ? point.a : point.b;
  }
};
template <>
struct geometry_concept<roof_vd::Segment> {
  using type = segment_concept;
};
template <>
struct segment_traits<roof_vd::Segment> {
  using coordinate_type = roof_vd::VD_int;
  using point_type = roof_vd::Point;

  static inline point_type get(const roof_vd::Segment& segment, const direction_1d& dir)
  {
    return dir.to_int() ? segment.p1 : segment.p0;
  }
};
}  // namespace boost::polygon

namespace roof_vd {

bool operator==(const Point& lhs, const Point& rhs)
{
  return lhs.a == rhs.a && lhs.b == rhs.b;
}

bool operator==(const Segment& lhs, const Segment& rhs)
{
  return lhs.p0 == rhs.p0 && lhs.p1 == rhs.p1;
}

bool segment_has_endpoint(const Segment& segment, const Point& point)
{
  return segment.p0 == point || segment.p1 == point;
}

double distance_to_segment(const Vector2d& vertex, const Segment& segment)
{
  Vector2d segment_normal(-(segment.p1.b - segment.p0.b), segment.p1.a - segment.p0.a);
  segment_normal.normalize();
  Vector2d p0_to_vertex(vertex[0] - segment.p0.a, vertex[1] - segment.p0.b);
  return std::abs(segment_normal.dot(p0_to_vertex));
}

double distance_to_point(const Vector2d& vertex, const Point& point)
{
  Vector2d point_to_vertex(vertex[0] - point.a, vertex[1] - point.b);
  return point_to_vertex.norm();
}

std::vector<Vector2d> discretize_arc(const Point& point,const Segment& segment,const Vector2d& v0,const Vector2d& v1,const RoofDiscretizer& discretizer) {
  const Vector2d p(point.a,point.b),p0(segment.p0.a,segment.p0.b),p1(segment.p1.a,segment.p1.b);
  const auto tangent=(p1-p0).normalized();
  const auto projected=p0+tangent*tangent.dot(p-p0);
  const double distance=(p-projected).norm();
  if(!(distance>0))throw std::runtime_error("Invalid roof parabolic arc.");
  const auto up=(p-projected)/distance;
  const Vector2d right(up.y(),-up.x());
  const double x0=right.dot(v0-p),x1=right.dot(v1-p);
  if(!(x0<x1))throw std::runtime_error("Invalid roof arc orientation.");
  const auto y=[distance](double x){return (x*x-distance*distance)/(2*distance);};
  std::vector<double> xs{x0,x1};
  for(;;){
    const double a=xs[xs.size()-2],b=xs.back(),dx=b-a,dy=y(b)-y(a),slope=(std::abs(a)<std::abs(b)?a:b)/distance;
    const double angle=std::abs(std::atan2(dx*slope-dy,dx+dy*slope));
    if(discretizer.overMaxAngle(angle)||(discretizer.hasMaxSegmentSqrLength()&&discretizer.overMaxSegmentSqrLength(dx*dx+dy*dy))){
      const double midpoint=(a+b)/2;
      if(midpoint==a||midpoint==b||xs.size()>2000000)throw std::runtime_error("Roof discretization exhausted.");
      xs.back()=midpoint;
    }else if(b==x1)break;else xs.push_back(x1);
  }
  std::vector<Vector2d> result;
  for(double x:xs)result.push_back(x==x0?v0:x==x1?v1:p+right*x+up*y(x));
  return result;
}

// a structure that saves 2d faces and heights of vertices
struct Faces_2_plus_1 {
  struct Vector2d_comp {
    bool operator()(const Vector2d& lhs, const Vector2d& rhs) const
    {
      return (lhs[0] < rhs[0]) || (lhs[0] == rhs[0] && lhs[1] < rhs[1]);
    }
  };
  std::vector<std::vector<Vector2d>> faces;
  std::map<Vector2d, double, Vector2d_comp> heights;
};

Faces_2_plus_1 vd_inner_faces(const voronoi_diagram& vd, const std::vector<Segment>& segments,
                              const RoofDiscretizer& discretizer)
{
  Faces_2_plus_1 ret;

  auto cell_contains_boundary_point = [&segments](const voronoi_diagram::cell_type *cell,
                                                  const Point& point) {
    Segment segment = segments[cell->source_index()];
    return (cell->contains_segment() && segment_has_endpoint(segment, point)) ||
           (cell->source_category() == ::boost::polygon::SOURCE_CATEGORY_SEGMENT_START_POINT &&
            segment.p0 == point) ||
           (cell->source_category() == ::boost::polygon::SOURCE_CATEGORY_SEGMENT_END_POINT &&
            segment.p1 == point);
  };

  for (const auto& cell : vd.cells()) {
    std::size_t cell_index = cell.source_index();
    if (cell.is_degenerate()) {
      RAISE_ROOF_EXCEPTION("Voronoi error");
    }
    const Segment& segment = segments[cell_index];

    if (cell.contains_segment()) {
      // walk around the cell, find edge starting from segment.p1 or passing through it
      const voronoi_diagram::edge_type *edge = cell.incident_edge();
      for (;;) {
        if (cell_contains_boundary_point(edge->twin()->cell(), segment.p1) &&
            !cell_contains_boundary_point(edge->next()->twin()->cell(), segment.p1)) {
          break;
        }
        edge = edge->next();
        if (edge == cell.incident_edge()) {
          RAISE_ROOF_EXCEPTION("Voronoi error");
        }
      }

      // add all inside edges
      ret.faces.emplace_back();  // Puts a new empty vector<Vector2d> at the end of ret.faces.
      {
        Vector2d p(segment.p1.a, segment.p1.b);
        ret.faces.back().push_back(p);
        ret.heights[p] = 0.0;
      }
      do {
        if (edge->is_linear()) {  // linear edge is simple
          auto vtx1 = SAFE_VERTEX(edge, 1);
          Vector2d p(vtx1->x(), vtx1->y());
          ret.faces.back().push_back(p);
          ret.heights[p] = distance_to_segment(p, segment);
        } else {  // discretize a parabolic edge
          const voronoi_diagram::cell_type *twin_cell = edge->twin()->cell();
          if (!(twin_cell->contains_point())) {
            RAISE_ROOF_EXCEPTION("Voronoi error");
          }
          Segment twin_segment = segments[twin_cell->source_index()];
          Point twin_point =
            (twin_cell->source_category() == ::boost::polygon::SOURCE_CATEGORY_SEGMENT_START_POINT)
              ? twin_segment.p0
              : twin_segment.p1;
          auto vtx0 = SAFE_VERTEX(edge, 0), vtx1 = SAFE_VERTEX(edge, 1);
          Vector2d v0(vtx0->x(), vtx0->y()), v1(vtx1->x(), vtx1->y());

          std::vector<Vector2d> discr = discretize_arc(twin_point, segment, v1, v0, discretizer);
          std::reverse(discr.begin(), discr.end());
          for (std::size_t k = 1; k < discr.size(); k++) {
            ret.faces.back().push_back(discr[k]);
            ret.heights[discr[k]] = distance_to_segment(discr[k], segment);
          }
        }
        edge = edge->next();
      } while (!cell_contains_boundary_point(edge->twin()->cell(), segment.p0));
      {
        Vector2d p(segment.p0.a, segment.p0.b);
        ret.faces.back().push_back(p);
        ret.heights[p] = 0.0;
      }
    } else {  // point cell
      const voronoi_diagram::edge_type *edge = cell.incident_edge();
      const Point point =
        (cell.source_category() == ::boost::polygon::SOURCE_CATEGORY_SEGMENT_START_POINT) ? segment.p0
                                                                                          : segment.p1;
      while (!(edge->is_secondary() && edge->prev()->is_secondary())) {
        edge = edge->next();
        if (edge == cell.incident_edge()) {
          RAISE_ROOF_EXCEPTION("Voronoi error");
        }
      }

      auto add_triangle = [&ret, &point](const Vector2d& v0, const Vector2d& v1) {
        ret.faces.emplace_back();

        Vector2d p(point.a, point.b);
        ret.faces.back().push_back(p);
        ret.heights[p] = 0.0;

        ret.faces.back().push_back(v0);
        ret.heights[v0] = distance_to_point(v0, point);

        ret.faces.back().push_back(v1);
        ret.heights[v1] = distance_to_point(v1, point);
      };

      if (edge->next()->next() != edge && segments[edge->twin()->cell()->source_index()].p0 ==
                                            segments[edge->prev()->twin()->cell()->source_index()].p1) {
        // inner non-degenerate cell
        for (;;) {
          edge = edge->next();
          if (edge->is_secondary()) {
            break;
          } else {
            auto vtx0 = SAFE_VERTEX(edge, 0), vtx1 = SAFE_VERTEX(edge, 1);
            Vector2d v0(vtx0->x(), vtx0->y()), v1(vtx1->x(), vtx1->y());
            if (edge->is_curved()) {
              Segment twin_segment = segments[edge->twin()->cell()->source_index()];
              std::vector<Vector2d> discr = discretize_arc(point, twin_segment, v0, v1, discretizer);
              for (std::size_t k = 1; k < discr.size(); k++) {
                add_triangle(discr[k - 1], discr[k]);
              }
            } else {
              add_triangle(v0, v1);
            }
          }
        }
      }
    }
  }
  return ret;
}


} // namespace roof_vd
extern "C" const char* roof_voronoi(const double* coordinates,const int* counts,int count,double fn,double fa,double fs) {
 static std::string output;
 try {
  double bound=0;int offset=0;
  for(int r=0;r<count;r++){double minX=INFINITY,minY=INFINITY,maxX=-INFINITY,maxY=-INFINITY;for(int i=0;i<counts[r];i++){const double x=coordinates[(offset+i)*2],y=coordinates[(offset+i)*2+1];minX=std::min(minX,x);minY=std::min(minY,y);maxX=std::max(maxX,x);maxY=std::max(maxY,y);bound=std::max({bound,std::abs(x),std::abs(y)});}bound=std::max({bound,maxX-minX,maxY-minY});offset+=counts[r];}
  if(!std::isfinite(bound)||bound==0)throw std::runtime_error("Empty roof outline.");
  const double scale=std::ldexp(1.0,31-(std::ilogb(bound)+1));
  std::vector<roof_vd::Segment> segments;std::vector<std::vector<roof_vd::Point>> rings;offset=0;
  for(int r=0;r<count;r++){std::vector<roof_vd::Point> ring;for(int i=0;i<counts[r];i++){
    const roof_vd::Point p(std::llround(coordinates[(offset+i)*2]*scale),std::llround(coordinates[(offset+i)*2+1]*scale));
    if(ring.empty()||!(ring.back()==p))ring.push_back(p);
   }offset+=counts[r];if(ring.size()>1&&ring.front()==ring.back())ring.pop_back();if(ring.size()<3)throw std::runtime_error("Roof outline collapsed at integer precision.");auto prev=ring.back();for(const auto& p:ring){segments.emplace_back(prev.a,prev.b,p.a,p.b);prev=p;}rings.push_back(ring);
  }
  roof_vd::voronoi_diagram vd;boost::polygon::construct_voronoi(segments.begin(),segments.end(),&vd);
  auto result=roof_vd::vd_inner_faces(vd,segments,RoofDiscretizer(fn,fa,fs,scale));
  std::ostringstream json;json<<std::setprecision(17)<<"{\"faces\":[";bool first=true;
  for(const auto& face:result.faces){if(!first)json<<',';first=false;json<<'[';bool fv=true;for(const auto& p:face){if(!fv)json<<',';fv=false;json<<'['<<p[0]/scale<<','<<p[1]/scale<<','<<result.heights.at(p)/scale<<']';}json<<']';}
  json<<"],\"floor\":[";first=true;for(const auto& ring:rings){if(!first)json<<',';first=false;json<<'[';bool fv=true;for(const auto& p:ring){if(!fv)json<<',';fv=false;json<<'['<<p.a/scale<<','<<p.b/scale<<']';}json<<']';}json<<"]}";output=json.str();
 }catch(const std::exception& error){std::ostringstream json;json<<"{\"error\":\"";for(const char* p=error.what();*p;p++)json<<(*p=='"'?' ':*p);json<<"\"}";output=json.str();}
 return output.c_str();
}

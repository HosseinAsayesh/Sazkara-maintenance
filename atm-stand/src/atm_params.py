"""
Universal ATM Stand - master parameters.

All dimensions in millimetres.  Coordinate system:
    X = width  (customer's left -> right)
    Y = depth  (0 = front edge of the plinth deck, +Y towards the rear / service side;
                the customer stands at negative Y)
    Z = height (0 = finished floor level)

Edit the values below and re-run `build.sh` (or run src/build_all.py inside FreeCAD)
to regenerate every model, drawing and export.
"""

P = dict(
    # ---------------------------------------------------------------- universal envelope
    # Range of ATM cabinets the stand accepts without modification
    atm_w_min=480, atm_w_max=780,     # cabinet width
    atm_d_min=550, atm_d_max=1000,    # cabinet depth
    atm_h_max=1600,                   # cabinet height (incl. topper)
    atm_mass_max=1000,                # kg, design load on the deck (static)

    # ---------------------------------------------------------------- reference ATM (fit check dummy)
    atm_w=660, atm_d=860, atm_h=1430,
    atm_setback=30,                   # ATM fascia set back from the deck front edge

    # ---------------------------------------------------------------- base frame (plinth)
    frame_w=960, frame_d=1150,
    rhs_h=80, rhs_w=40, rhs_t=3,      # RHS 80x40x3 S355 welded frame
    bearer_x=150,                     # centre-line offset of the two inner bearers
    cross_y=(497.5, 807.5),           # centre-lines of the two cross members
    foot_h=40,                        # floor -> underside of frame (levelling feet nominal)
    foot_adj=25,                      # +/- levelling adjustment
    deck_t=10,                        # S355 deck plate
    skirt_t=2,                        # 2 mm galvanised / powder-coated skirting
    skirt_gap=10,                     # skirt clearance above floor

    # universal slot pattern on the deck (for M16 T-bolts / ATM anchor bolts)
    slot_w=18,
    xslot_cx=320, xslot_len=220,      # lateral slots, centred at +/- xslot_cx
    xslot_rows=7, xslot_y0=110, xslot_pitch=155,
    yslot_x=90, yslot_w=18,           # longitudinal slots at +/- yslot_x
    yslot_segments=((140, 460), (540, 770), (845, 1080)),
    cable_hole_d=120,                 # central cable entry (with grommet)

    # adjustable stops (universal clamp kit)
    stop_leg=60, stop_t=6,

    # ---------------------------------------------------------------- privacy surround (optional)
    surround=True,
    total_h=2250,                     # floor -> top of canopy
    wing_t=50,                        # privacy wing thickness
    wing_front=300,                   # wing projection in front of the deck
    canopy_h=220, canopy_overhang=60,
    rear_wall_t=40,
    header_z=1740,                    # underside of the front header panel
    door_w=760, door_h=1900,          # rear service door

    show_atm=True,
)


def derived(p=P):
    d = dict(p)
    d["frame_z0"] = p["foot_h"]
    d["deck_z0"] = p["foot_h"] + p["rhs_h"]
    d["deck_top"] = d["deck_z0"] + p["deck_t"]
    d["half_w"] = p["frame_w"] / 2.0
    d["wing_x0"] = d["half_w"] + p["skirt_t"]            # inner face of wings
    d["wing_x1"] = d["wing_x0"] + p["wing_t"]            # outer face of wings
    d["rear_y"] = p["frame_d"] + p["skirt_t"]            # rear wall inner face
    d["rear_y1"] = d["rear_y"] + p["rear_wall_t"]        # rear wall outer face
    d["canopy_z0"] = p["total_h"] - p["canopy_h"]
    d["xslot_rows_y"] = [p["xslot_y0"] + i * p["xslot_pitch"] for i in range(p["xslot_rows"])]
    return d

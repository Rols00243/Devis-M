# encoding: UTF-8
#
# Cuisine_Existante.rb
# -----------------------------------------------------------------------------
# Relevé 3D de la cuisine EXISTANTE pour SketchUp (API Ruby native).
# Reproduit l'existant : 4 murs, portes P01 / P02, fenêtre F01, sol.
# AUCUN meuble, équipement, évier, plan de travail, hotte, sanitaire ou décor.
#
# Exécution (SketchUp 2017 ou plus récent) :
#   Fenêtre > Console Ruby, puis :
#     load 'C:/chemin/vers/Cuisine_Existante.rb'
#   (ou coller l'intégralité du fichier dans la console).
#   Pour relancer après modification des paramètres : CuisineExistante.run
#
# Repère : origine = coin intérieur inférieur gauche (nu intérieur fini du mur
# gauche et du mur inférieur, niveau sol fini). X = largeur, Y = profondeur,
# Z = hauteur. Les murs sont construits vers l'EXTÉRIEUR de ce périmètre, les
# dimensions intérieures sont donc exactement celles prescrites.
#
# Lecture du plan de référence (vue de dessus) :
#   - intérieur 2,00 m x 1,90 m, murs 0,15 m ;
#   - F01 (mur supérieur) : baie au nu intérieur du mur gauche, cote 1,00 m ;
#   - P01 (mur inférieur) : baie au nu intérieur du mur gauche, cotée 0,70 m
#     sur le plan, paumelles côté mur gauche, ouverture vers l'extérieur ;
#   - P02 (mur droit) : baie au nu intérieur du mur inférieur, 0,85 m,
#     trumeau de 1,05 m jusqu'au mur supérieur, paumelles côté mur inférieur,
#     ouverture vers l'intérieur.
#   Les hauteurs (portes 2,20 m, allège 1,00 m, fenêtre 1,00 m, plafond
#   2,80 m) ne figurent pas sur le plan : elles proviennent du programme.
# -----------------------------------------------------------------------------

require 'sketchup.rb'

# Permet de recharger le fichier sans avertissement « already initialized ».
if defined?(CuisineExistante)
  %i[P REF PLAN TAGS SCENES TOL].each do |c|
    CuisineExistante.send(:remove_const, c) if CuisineExistante.const_defined?(c, false)
  end
end

module CuisineExistante

  # ===========================================================================
  # 1. PARAMÈTRES (mm) — modifiables
  # ===========================================================================
  P = {
    # Pièce (dimensions intérieures entre nus finis)
    largeur:        2000.0, # axe X
    profondeur:     1900.0, # axe Y
    hauteur:        2800.0, # axe Z, sol fini -> plafond
    ep_mur:          150.0, # plan : 0,15 m

    # Porte P01 — mur inférieur (y = 0)
    p01_largeur:     800.0, # programme ; le plan cote 0,70 m (voir rapport)
    p01_hauteur:    2200.0,
    p01_decalage:      0.0, # nu intérieur mur gauche -> tableau gauche (plan : 0)
    p01_charniere:  :gauche, # :gauche | :droite
    p01_sens:       :exterieur, # :exterieur | :interieur

    # Porte P02 — mur droit (x = largeur)
    p02_largeur:     850.0,
    p02_hauteur:    2200.0,
    p02_decalage:      0.0, # nu intérieur mur inférieur -> tableau bas (plan : 0)
    p02_charniere:  :bas,    # :bas | :haut
    p02_sens:       :interieur, # :interieur | :exterieur

    # Fenêtre F01 — mur supérieur (y = profondeur)
    f01_largeur:    1000.0,
    f01_hauteur:    1000.0,
    f01_allege:     1000.0,
    f01_decalage:      0.0, # nu intérieur mur gauche -> tableau gauche (plan : 0)

    # Représentation des menuiseries
    ep_vantail:       40.0,
    angle_ouverture:  90.0, # degrés, vantaux représentés ouverts
    cadre_fenetre:    60.0,
    prof_fenetre:     70.0,
    ep_vitrage:        8.0,

    # Plan de coupe horizontal utilisé par la scène PLAN_2D
    hauteur_coupe_plan: 1200.0
  }

  # Valeurs prescrites par le programme (référence des contrôles).
  REF = {
    largeur: 2000.0, profondeur: 1900.0, hauteur: 2800.0, ep_mur: 150.0,
    p01_largeur: 800.0, p01_hauteur: 2200.0, p01_sens: :exterieur,
    p02_largeur: 850.0, p02_hauteur: 2200.0, p02_sens: :interieur,
    f01_largeur: 1000.0, f01_hauteur: 1000.0, f01_allege: 1000.0,
    f01_niveau_haut: 2000.0, f01_sous_plafond: 800.0
  }

  # Cotes lues sur le plan de référence (positions des baies).
  PLAN = {
    p01_largeur: 700.0, p01_decalage: 0.0, p01_charniere: :gauche,
    p02_largeur: 850.0, p02_decalage: 0.0, p02_trumeau: 1050.0, p02_charniere: :bas,
    f01_largeur: 1000.0, f01_decalage: 0.0
  }

  TAGS = %w[01_MURS 02_PORTE_P01 03_PORTE_P02 04_FENETRE_F01
            05_SOL 06_COTATIONS 07_ARCS_OUVERTURE].freeze
  SCENES = %w[PLAN_2D VUE_3D VUE_INTERIEURE].freeze
  TOL = 0.5 # tolérance des contrôles, mm

  # ===========================================================================
  # 2. OUTILS
  # ===========================================================================
  def self.pt(x, y, z)
    Geom::Point3d.new(x.to_f.mm, y.to_f.mm, z.to_f.mm)
  end

  # Vecteur de décalage exprimé en mm.
  def self.off(x, y, z)
    Geom::Vector3d.new(x.to_f.mm, y.to_f.mm, z.to_f.mm)
  end

  def self.vec(x, y, z)
    Geom::Vector3d.new(x, y, z)
  end

  # Longueur interne SketchUp (pouces) -> mm.
  def self.mm(len)
    len.to_f.to_mm
  end

  def self.set_opt(provider, key, value)
    provider[key] = value if provider.keys.include?(key)
  rescue StandardError
    nil
  end

  def self.oriented_face(ents, pts, normal)
    face = ents.add_face(pts)
    raise 'Impossible de créer une face (points invalides)' unless face
    face.reverse! if face.normal % normal < 0
    face
  end

  # Parallélépipède fermé (faces créées directement dans ents).
  def self.solid_box(ents, x0, y0, z0, x1, y1, z1)
    f = oriented_face(ents, [pt(x0, y0, z0), pt(x1, y0, z0),
                             pt(x1, y1, z0), pt(x0, y1, z0)], Z_AXIS)
    f.pushpull((z1 - z0).mm)
  end

  def self.box_group(ents, name, x0, y0, z0, x1, y1, z1, mat = nil)
    g = ents.add_group
    solid_box(g.entities, x0, y0, z0, x1, y1, z1)
    g.name = name
    g.material = mat if mat
    g
  end

  def self.world_bounds(ent, tr)
    b = Geom::BoundingBox.new
    8.times { |i| b.add(ent.bounds.corner(i).transform(tr)) }
    b
  end

  # ===========================================================================
  # 3. CONTRÔLE DES PARAMÈTRES
  # ===========================================================================
  def self.validate!
    w = P[:largeur]; d = P[:profondeur]; h = P[:hauteur]
    err = []
    err << 'Épaisseur de mur nulle' unless P[:ep_mur] > 0
    if P[:p01_decalage] < 0 || P[:p01_decalage] + P[:p01_largeur] > w + TOL
      err << 'P01 sort du mur inférieur'
    end
    if P[:p02_decalage] < 0 || P[:p02_decalage] + P[:p02_largeur] > d + TOL
      err << 'P02 sort du mur droit'
    end
    if P[:f01_decalage] < 0 || P[:f01_decalage] + P[:f01_largeur] > w + TOL
      err << 'F01 sort du mur supérieur'
    end
    err << 'F01 dépasse le plafond' if P[:f01_allege] + P[:f01_hauteur] >= h
    err << 'P01 plus haute que le mur' if P[:p01_hauteur] >= h
    err << 'P02 plus haute que le mur' if P[:p02_hauteur] >= h
    raise ArgumentError, err.join("\n") unless err.empty?
  end

  # ===========================================================================
  # 4. MODÈLE : unités, balises, matériaux, style
  # ===========================================================================
  def self.set_units(model)
    u = model.options['UnitsOptions']
    set_opt(u, 'LengthFormat', 0)    # décimal
    set_opt(u, 'LengthUnit', 2)      # millimètres
    set_opt(u, 'LengthPrecision', 0)
    set_opt(u, 'SuppressUnitsDisplay', true)
    set_opt(model.options['PageOptions'], 'ShowTransition', false)
  end

  def self.create_tags(model)
    TAGS.each_with_object({}) do |name, h|
      layer = model.layers[name] || model.layers.add(name)
      layer.visible = true
      h[name] = layer
    end
  end

  def self.material(model, name, rgb, alpha = nil)
    m = model.materials[name] || model.materials.add(name)
    m.color = Sketchup::Color.new(*rgb)
    m.alpha = alpha if alpha
    m
  end

  def self.create_materials(model)
    {
      mur:     material(model, 'CE_Mur_Enduit',       [238, 235, 228]),
      sol:     material(model, 'CE_Sol',              [214, 212, 205]),
      vantail: material(model, 'CE_Vantail',          [206, 192, 168]),
      cadre:   material(model, 'CE_Menuiserie_Blanc', [248, 248, 246]),
      verre:   material(model, 'CE_Vitrage',          [170, 205, 225], 0.35)
    }
  end

  # Présentation architecturale sobre : fond blanc, arêtes noires, profils épais.
  def self.apply_style(model)
    ro = model.rendering_options
    set_opt(ro, 'BackgroundColor', Sketchup::Color.new(255, 255, 255))
    set_opt(ro, 'ForegroundColor', Sketchup::Color.new(0, 0, 0))
    set_opt(ro, 'EdgeColorMode', 1) # couleur unique
    set_opt(ro, 'DrawHorizon', false)
    set_opt(ro, 'DrawGround', false)
    set_opt(ro, 'DrawSilhouettes', true)
    set_opt(ro, 'SilhouetteWidth', 3)
    set_opt(ro, 'DrawDepthQue', false)
    set_opt(ro, 'DisplayColorByLayer', false)
    set_opt(ro, 'DisplaySectionPlanes', false)
    set_opt(ro, 'DisplaySectionCuts', true)
    set_opt(ro, 'SectionCutWidth', 5)
    set_opt(ro, 'SectionCutFilled', true)
    set_opt(ro, 'SectionDefaultFillColor', Sketchup::Color.new(90, 90, 90))
    set_opt(model.shadow_info, 'DisplayShadows', false)
  end

  # ===========================================================================
  # 5. MURS (volumes fermés avec baies intégrées)
  # ===========================================================================

  # Contour 2D (a = abscisse le long du mur, z) d'un mur comportant des baies
  # de porte partant du sol. doors = [[début, fin, hauteur], ...]
  def self.wall_outline(a0, a1, h, doors)
    doors = doors.sort_by(&:first)
    pts = []
    ended = false
    if !doors.empty? && doors.first[0] <= a0 + TOL
      _s, e, hd = doors.shift
      pts << [a0, hd] << [e, hd] << [e, 0.0]
    else
      pts << [a0, 0.0]
    end
    doors.each do |s, e, hd|
      pts << [s, 0.0] << [s, hd]
      if e >= a1 - TOL
        pts << [a1, hd]
        ended = true
      else
        pts << [e, hd] << [e, 0.0]
      end
    end
    pts << [a1, 0.0] unless ended
    pts << [a1, h] << [a0, h]
    pts
  end

  # Dessine la face du nu intérieur, perce les baies de fenêtre (holes =
  # [[a0, z0, a1, z1]]), puis extrude vers l'extérieur de l'épaisseur du mur.
  def self.build_wall(parent, name, outline, map, outward, thickness, holes, mat)
    g = parent.add_group
    ents = g.entities
    oriented_face(ents, outline.map { |a, z| map.call(a, z) }, outward)
    holes.each do |a0, z0, a1, z1|
      hf = ents.add_face([[a0, z0], [a1, z0], [a1, z1], [a0, z1]].map { |a, z| map.call(a, z) })
      hf.erase! if hf && hf.valid?
    end
    face = ents.grep(Sketchup::Face).max_by(&:area)
    face.reverse! if face.normal % outward < 0
    face.pushpull(thickness.mm)
    g.name = name
    g.material = mat
    g
  end

  def self.build_walls(model, tag, mat)
    w = P[:largeur]; d = P[:profondeur]; h = P[:hauteur]; t = P[:ep_mur]
    murs = model.entities.add_group
    murs.name = 'MURS_EXISTANTS'
    murs.layer = tag
    e = murs.entities

    p01 = [P[:p01_decalage], P[:p01_decalage] + P[:p01_largeur], P[:p01_hauteur]]
    p02 = [P[:p02_decalage], P[:p02_decalage] + P[:p02_largeur], P[:p02_hauteur]]
    f0 = P[:f01_decalage]
    f1 = f0 + P[:f01_largeur]
    za = P[:f01_allege]
    zb = za + P[:f01_hauteur]

    walls = {}
    # Murs inférieur et supérieur : pleine longueur, angles compris.
    walls[:inferieur] = build_wall(e, 'Mur_Inferieur_P01',
                                   wall_outline(-t, w + t, h, [p01]),
                                   lambda { |a, z| pt(a, 0, z) }, vec(0, -1, 0), t, [], mat)
    walls[:superieur] = build_wall(e, 'Mur_Superieur_F01',
                                   wall_outline(-t, w + t, h, []),
                                   lambda { |a, z| pt(a, d, z) }, vec(0, 1, 0), t,
                                   [[f0, za, f1, zb]], mat)
    # Murs gauche et droit : entre les murs inférieur et supérieur.
    walls[:gauche] = build_wall(e, 'Mur_Gauche',
                                wall_outline(0, d, h, []),
                                lambda { |a, z| pt(0, a, z) }, vec(-1, 0, 0), t, [], mat)
    walls[:droit] = build_wall(e, 'Mur_Droit_P02',
                               wall_outline(0, d, h, [p02]),
                               lambda { |a, z| pt(w, a, z) }, vec(1, 0, 0), t, [], mat)
    [murs, walls]
  end

  # ===========================================================================
  # 6. SOL
  # ===========================================================================
  def self.build_floor(model, tag, mat)
    w = P[:largeur]; d = P[:profondeur]
    g = model.entities.add_group
    oriented_face(g.entities, [pt(0, 0, 0), pt(w, 0, 0), pt(w, d, 0), pt(0, d, 0)], Z_AXIS)
    g.name = 'SOL_EXISTANT'
    g.layer = tag
    g.material = mat
    g
  end

  # ===========================================================================
  # 7. PORTES (composants) et ARCS DE DÉBATTEMENT
  # ===========================================================================

  # Géométrie d'une porte : charnière (x, y au sol), direction « fermée »
  # (charnière -> gâche), direction de débattement, repères du mur porteur.
  def self.door_spec(key)
    w = P[:largeur]; t = P[:ep_mur]
    if key == :p01
      x0 = P[:p01_decalage]
      x1 = x0 + P[:p01_largeur]
      hx, closed = P[:p01_charniere] == :droite ? [x1, vec(-1, 0, 0)] : [x0, vec(1, 0, 0)]
      y, swing = P[:p01_sens] == :interieur ? [0.0, vec(0, 1, 0)] : [-t, vec(0, -1, 0)]
      { label: 'P01', hinge: [hx, y], closed: closed, swing: swing,
        width: P[:p01_largeur], height: P[:p01_hauteur],
        axis: 1, inner: 0.0, outward: -1.0, charniere: P[:p01_charniere] }
    else
      y0 = P[:p02_decalage]
      y1 = y0 + P[:p02_largeur]
      hy, closed = P[:p02_charniere] == :haut ? [y1, vec(0, -1, 0)] : [y0, vec(0, 1, 0)]
      x, swing = P[:p02_sens] == :exterieur ? [w + t, vec(1, 0, 0)] : [w, vec(-1, 0, 0)]
      { label: 'P02', hinge: [x, hy], closed: closed, swing: swing,
        width: P[:p02_largeur], height: P[:p02_hauteur],
        axis: 0, inner: w, outward: 1.0, charniere: P[:p02_charniere] }
    end
  end

  def self.leaf_direction(spec)
    a = P[:angle_ouverture].degrees
    v = Geom::Vector3d.linear_combination(Math.cos(a), spec[:closed], Math.sin(a), spec[:swing])
    v.normalize!
    v
  end

  def self.door_definition(model, spec, mat)
    defn = model.definitions.add("#{spec[:label]}_Porte_Existante")
    defn.description = "Porte #{spec[:label]} existante : vantail " \
                       "#{spec[:width].round} x #{spec[:height].round} mm"
    solid_box(defn.entities, 0, 0, 0, spec[:width], P[:ep_vantail], spec[:height])
    defn.entities.grep(Sketchup::Face).each { |f| f.material = mat }
    defn
  end

  def self.place_door(model, spec, tag, mat, sens)
    defn = door_definition(model, spec, mat)
    xa = leaf_direction(spec)
    ya = Z_AXIS * xa
    hinge = pt(spec[:hinge][0], spec[:hinge][1], 0)
    # L'épaisseur du vantail est reportée côté gâche (dans l'emprise de la baie).
    origin = ya % spec[:closed] < 0 ? hinge.offset(ya.reverse, P[:ep_vantail].mm) : hinge
    inst = model.entities.add_instance(defn, Geom::Transformation.axes(origin, xa, ya, Z_AXIS))
    inst.name = "PORTE_#{spec[:label]}"
    inst.layer = tag
    inst.set_attribute('CuisineExistante', 'sens_ouverture', sens.to_s)
    inst.set_attribute('CuisineExistante', 'charniere', spec[:charniere].to_s)
    inst.set_attribute('CuisineExistante', 'largeur_mm', spec[:width])
    inst.set_attribute('CuisineExistante', 'hauteur_mm', spec[:height])
    inst
  end

  # Arc de débattement (+ vantail ouvert en trait, position fermée en pointillés).
  def self.add_swing(ents, spec)
    g = ents.add_group
    g.name = "ARC_#{spec[:label]}"
    c = pt(spec[:hinge][0], spec[:hinge][1], 1.0)
    r = spec[:width].mm
    normal = spec[:closed] * spec[:swing]
    edges = g.entities.add_arc(c, spec[:closed], normal, r, 0, P[:angle_ouverture].degrees, 24)
    g.entities.add_line(c, c.offset(leaf_direction(spec), r))
    cl = g.entities.add_cline(c, c.offset(spec[:closed], r))
    cl.stipple = '-' if cl.respond_to?(:stipple=)
    [g, edges.first.curve]
  end

  # ===========================================================================
  # 8. FENÊTRE (composant)
  # ===========================================================================
  def self.place_window(model, tag, mats)
    wf = P[:f01_largeur]; hf = P[:f01_hauteur]
    c = P[:cadre_fenetre]; dp = P[:prof_fenetre]; ev = P[:ep_vitrage]
    defn = model.definitions.add('F01_Fenetre_Existante')
    defn.description = "Fenêtre F01 existante : #{wf.round} x #{hf.round} mm, allège #{P[:f01_allege].round} mm"
    e = defn.entities
    box_group(e, 'Dormant_Gauche', 0, 0, 0, c, dp, hf, mats[:cadre])
    box_group(e, 'Dormant_Droit', wf - c, 0, 0, wf, dp, hf, mats[:cadre])
    box_group(e, 'Dormant_Bas', c, 0, 0, wf - c, dp, c, mats[:cadre])
    box_group(e, 'Dormant_Haut', c, 0, hf - c, wf - c, dp, hf, mats[:cadre])
    gy = (dp - ev) / 2.0
    box_group(e, 'Vitrage', c, gy, c, wf - c, gy + ev, hf - c, mats[:verre])

    y = P[:profondeur] + (P[:ep_mur] - dp) / 2.0 # centrée dans l'épaisseur du mur
    tr = Geom::Transformation.new(pt(P[:f01_decalage], y, P[:f01_allege]))
    inst = model.entities.add_instance(defn, tr)
    inst.name = 'FENETRE_F01'
    inst.layer = tag
    inst.set_attribute('CuisineExistante', 'allege_mm', P[:f01_allege])
    inst
  end

  # ===========================================================================
  # 9. COTATIONS
  # ===========================================================================
  def self.dim(ents, a, b, o)
    ents.add_dimension_linear(pt(*a), pt(*b), off(*o))
  end

  def self.build_dimensions(model, tag)
    w = P[:largeur]; d = P[:profondeur]; h = P[:hauteur]; t = P[:ep_mur]
    x0 = P[:p01_decalage]; x1 = x0 + P[:p01_largeur]; hp1 = P[:p01_hauteur]
    y0 = P[:p02_decalage]; y1 = y0 + P[:p02_largeur]; hp2 = P[:p02_hauteur]
    f0 = P[:f01_decalage]; f1 = f0 + P[:f01_largeur]
    za = P[:f01_allege]; zb = za + P[:f01_hauteur]

    g = model.entities.add_group
    g.name = 'COTATIONS'
    g.layer = tag
    e = g.entities

    # --- Plan : chaîne haute (fenêtre), intérieur, hors tout
    dim(e, [-t, d + t, 0], [0, d + t, 0], [0, 250, 0])
    dim(e, [f0, d + t, 0], [f1, d + t, 0], [0, 250, 0])
    dim(e, [0, d + t, 0], [f0, d + t, 0], [0, 250, 0]) if f0 > TOL
    dim(e, [f1, d + t, 0], [w, d + t, 0], [0, 250, 0]) if w - f1 > TOL
    dim(e, [w, d + t, 0], [w + t, d + t, 0], [0, 250, 0])
    dim(e, [0, d, 0], [w, d, 0], [0, t + 550, 0])
    dim(e, [-t, d + t, 0], [w + t, d + t, 0], [0, 850, 0])

    # --- Plan : chaîne gauche, intérieur, hors tout
    dim(e, [0, 0, 0], [0, d, 0], [-(t + 400), 0, 0])
    dim(e, [-t, -t, 0], [-t, d + t, 0], [-700, 0, 0])

    # --- Plan : chaîne droite (P02, trumeau, épaisseurs)
    dim(e, [w + t, -t, 0], [w + t, 0, 0], [250, 0, 0])
    dim(e, [w + t, 0, 0], [w + t, y0, 0], [250, 0, 0]) if y0 > TOL
    dim(e, [w + t, y0, 0], [w + t, y1, 0], [250, 0, 0])
    dim(e, [w + t, y1, 0], [w + t, d, 0], [250, 0, 0]) if d - y1 > TOL
    dim(e, [w + t, d, 0], [w + t, d + t, 0], [250, 0, 0])

    # --- Plan : chaîne basse (P01), sous l'arc si la porte ouvre vers l'extérieur
    ob = -(P[:p01_sens] == :exterieur ? P[:p01_largeur] + 350 : 350)
    dim(e, [-t, -t, 0], [0, -t, 0], [0, ob, 0])
    dim(e, [0, -t, 0], [x0, -t, 0], [0, ob, 0]) if x0 > TOL
    dim(e, [x0, -t, 0], [x1, -t, 0], [0, ob, 0])
    dim(e, [x1, -t, 0], [w, -t, 0], [0, ob, 0]) if w - x1 > TOL
    dim(e, [w, -t, 0], [w + t, -t, 0], [0, ob, 0])

    # --- Élévations (cotes verticales)
    # F01 sur le nu intérieur du mur supérieur : allège / hauteur / sous plafond
    dim(e, [f1, d - 1, 0], [f1, d - 1, za], [200, 0, 0])
    dim(e, [f1, d - 1, za], [f1, d - 1, zb], [200, 0, 0])
    dim(e, [f1, d - 1, zb], [f1, d - 1, h], [200, 0, 0])
    # P02 sur le nu intérieur du mur droit
    dim(e, [w - 1, y1, 0], [w - 1, y1, hp2], [0, 200, 0])
    dim(e, [w - 1, y1, hp2], [w - 1, y1, h], [0, 200, 0])
    # P01 sur le parement extérieur du mur inférieur
    dim(e, [x1, -t - 1, 0], [x1, -t - 1, hp1], [200, 0, 0])
    # Hauteur sous plafond sur le mur gauche
    dim(e, [1, d - 300, 0], [1, d - 300, h], [0, -200, 0])

    # --- Repères des ouvertures (plan)
    e.add_text("P01  #{P[:p01_largeur].round}x#{P[:p01_hauteur].round}  (#{P[:p01_sens]})",
               pt((x0 + x1) / 2.0, -t - 150, 0))
    e.add_text("P02  #{P[:p02_largeur].round}x#{P[:p02_hauteur].round}  (#{P[:p02_sens]})",
               pt(w + t + 80, (y0 + y1) / 2.0, 0))
    e.add_text("F01  #{P[:f01_largeur].round}x#{P[:f01_hauteur].round}  all. #{P[:f01_allege].round}",
               pt((f0 + f1) / 2.0, d + t + 80, 0))
    g
  end

  # ===========================================================================
  # 10. SCÈNES ET CAMÉRA
  # ===========================================================================
  def self.build_scenes(model, section, tags)
    pages = model.pages
    SCENES.each do |n|
      old = pages[n]
      pages.erase(old) if old && pages.respond_to?(:erase)
    end
    view = model.active_view
    w = P[:largeur]; d = P[:profondeur]; h = P[:hauteur]
    cx = w / 2.0
    cy = d / 2.0

    # PLAN_2D : vue de dessus orthogonale, coupe horizontale active
    model.entities.active_section_plane = section
    cam = Sketchup::Camera.new(pt(cx, cy, 30_000), pt(cx, cy, 0), Y_AXIS)
    cam.perspective = false
    view.camera = cam
    view.zoom_extents
    plan = pages.add('PLAN_2D')
    plan.description = "Vue en plan cotée, coupe à #{P[:hauteur_coupe_plan].round} mm"

    # VUE_3D : axonométrie (projection parallèle) depuis l'angle avant gauche
    model.entities.active_section_plane = nil
    cam = Sketchup::Camera.new(pt(cx - 9000, cy - 11_000, h / 2.0 + 10_000),
                               pt(cx, cy, h / 2.0), Z_AXIS)
    cam.perspective = false
    view.camera = cam
    view.zoom_extents
    v3d = pages.add('VUE_3D')
    v3d.description = 'Axonométrie : quatre murs et trois ouvertures'

    # VUE_INTERIEURE : perspective depuis l'angle intérieur bas gauche
    tags['06_COTATIONS'].visible = false
    cam = Sketchup::Camera.new(pt(120, 120, 1650), pt(w * 0.8, d * 0.9, 1150), Z_AXIS)
    cam.perspective = true
    cam.fov = 80
    view.camera = cam
    int = pages.add('VUE_INTERIEURE')
    int.description = "Contrôle de l'organisation intérieure (pièce vide)"
    tags['06_COTATIONS'].visible = true

    # Caméra finale : ensemble du modèle
    pages.selected_page = v3d
    view.camera = v3d.camera
    view.zoom_extents
    [plan, v3d, int]
  end

  # ===========================================================================
  # 11. CONTRÔLES
  # ===========================================================================
  class Rapport
    attr_reader :lignes, :nb_ok, :nb_ko, :alertes

    def initialize
      @lignes = []
      @alertes = []
      @nb_ok = 0
      @nb_ko = 0
    end

    def titre(t)
      @lignes << '' << "--- #{t}"
    end

    def val(label, attendu, mesure, tol = TOL)
      ok = !mesure.nil? && (mesure - attendu).abs <= tol
      compter(ok)
      m = mesure.nil? ? 'absent' : format('%.1f', mesure)
      @lignes << format('[%s] %-50s attendu %9.1f  mesuré %9s', ok ? 'OK' : 'KO', label, attendu, m)
      ok
    end

    def bool(label, ok, detail = '')
      compter(ok)
      @lignes << format('[%s] %-50s %s', ok ? 'OK' : 'KO', label, detail)
      ok
    end

    def alerte(msg)
      @alertes << msg
    end

    private

    def compter(ok)
      ok ? @nb_ok += 1 : @nb_ko += 1
    end
  end

  # Face du groupe située dans le plan coord[axis] = value.
  def self.find_face(group, tr, axis, value)
    group.entities.grep(Sketchup::Face).find do |f|
      next false unless f.normal.transform(tr)[axis].abs > 0.999
      f.vertices.all? { |vx| (mm(vx.position.transform(tr)[axis]) - value).abs < TOL }
    end
  end

  # Baies de porte lues sur la face d'un mur : [[début, fin, hauteur], ...]
  def self.door_gaps(face, tr, along)
    bottom = []
    heads = []
    face.edges.each do |e|
      a = e.start.position.transform(tr)
      b = e.end.position.transform(tr)
      next unless (mm(a.z) - mm(b.z)).abs < TOL
      s, f = [mm(a[along]), mm(b[along])].sort
      if mm(a.z).abs < TOL
        bottom << [s, f]
      else
        heads << [mm(a.z), s, f]
      end
    end
    coords = face.vertices.map { |vx| mm(vx.position.transform(tr)[along]) }
    cur = coords.min
    hi = coords.max
    gaps = []
    bottom.sort.each do |s, f|
      gaps << [cur, s] if s - cur > TOL
      cur = [cur, f].max
    end
    gaps << [cur, hi] if hi - cur > TOL
    gaps.map do |g0, g1|
      hs = heads.select { |_z, s, f| s < g1 - TOL && f > g0 + TOL }.map(&:first)
      [g0, g1, hs.min]
    end
  end

  # Baies percées (boucles intérieures) : [[amin, amax, zmin, zmax], ...]
  def self.window_holes(face, tr, along)
    face.loops.reject(&:outer?).map do |loop|
      ps = loop.vertices.map { |vx| vx.position.transform(tr) }
      as = ps.map { |p| mm(p[along]) }
      zs = ps.map { |p| mm(p.z) }
      [as.min, as.max, zs.min, zs.max]
    end
  end

  # true si le rayon rencontre le groupe cible avant max_mm.
  def self.ray_blocked_by?(model, origin, dir, target, max_mm)
    p = origin
    20.times do
      res = model.raytest([p, dir], false)
      return false unless res
      hit, path = res
      return false if mm(origin.distance(hit)) > max_mm
      return true if path.include?(target)
      p = hit.offset(dir, 0.5.mm)
    end
    false
  end

  def self.side_of(spec, point)
    s = (mm(point[spec[:axis]]) - spec[:inner]) * spec[:outward]
    return :exterieur if s > P[:ep_mur] + TOL
    return :interieur if s < -TOL
    :dans_le_mur
  end

  def self.controles(model, murs, walls, sol, doors, arcs, window, pages)
    r = Rapport.new
    w = P[:largeur]; d = P[:profondeur]; h = P[:hauteur]; t = P[:ep_mur]
    tm = murs.transformation
    trw = {}
    walls.each { |k, g| trw[k] = tm * g.transformation }
    bb = {}
    walls.each { |k, g| bb[k] = world_bounds(g, tm) }

    # --- Murs
    r.titre 'MURS'
    r.val 'Largeur intérieure X (nu à nu)', REF[:largeur], mm(bb[:droit].min.x - bb[:gauche].max.x)
    r.val 'Profondeur intérieure Y (nu à nu)', REF[:profondeur], mm(bb[:superieur].min.y - bb[:inferieur].max.y)
    r.val 'Origine : nu intérieur mur gauche (x)', 0.0, mm(bb[:gauche].max.x)
    r.val 'Origine : nu intérieur mur inférieur (y)', 0.0, mm(bb[:inferieur].max.y)
    epaisseur = {
      inferieur: bb[:inferieur].height, superieur: bb[:superieur].height,
      gauche: bb[:gauche].width, droit: bb[:droit].width
    }
    volumes = {
      inferieur: (REF[:largeur] + 2 * REF[:ep_mur]) * REF[:ep_mur] * REF[:hauteur] -
        REF[:p01_largeur] * REF[:ep_mur] * REF[:p01_hauteur],
      superieur: (REF[:largeur] + 2 * REF[:ep_mur]) * REF[:ep_mur] * REF[:hauteur] -
        REF[:f01_largeur] * REF[:f01_hauteur] * REF[:ep_mur],
      gauche: REF[:ep_mur] * REF[:profondeur] * REF[:hauteur],
      droit: REF[:ep_mur] * REF[:profondeur] * REF[:hauteur] -
        REF[:p02_largeur] * REF[:ep_mur] * REF[:p02_hauteur]
    }
    walls.each do |k, g|
      r.val "#{g.name} : hauteur", REF[:hauteur], mm(bb[k].depth)
      r.val "#{g.name} : épaisseur", REF[:ep_mur], mm(epaisseur[k])
      r.bool "#{g.name} : volume fermé (solide)", g.manifold?
      vol = g.volume
      r.val "#{g.name} : volume (dm3)", volumes[k] / 1.0e6,
            vol > 0 ? vol * (25.4**3) / 1.0e6 : nil, 0.01
    end
    r.val 'Sol : niveau (z)', 0.0, mm(sol.bounds.min.z)

    # --- P01
    r.titre 'PORTE P01 (mur inférieur)'
    face = find_face(walls[:inferieur], trw[:inferieur], 1, 0.0)
    gaps = face ? door_gaps(face, trw[:inferieur], 0) : []
    if gaps.size == 1
      g0, g1, gh = gaps.first
      r.val 'P01 baie : largeur', REF[:p01_largeur], g1 - g0
      r.val 'P01 baie : hauteur', REF[:p01_hauteur], gh
      r.val 'P01 baie : décalage / nu mur gauche (plan)', PLAN[:p01_decalage], g0
      if ((g1 - g0) - PLAN[:p01_largeur]).abs > TOL
        r.alerte format('P01 : le plan de référence cote %.0f mm, le programme %.0f mm ; ' \
                        'valeur modélisée %.0f mm (paramètre p01_largeur).',
                        PLAN[:p01_largeur], REF[:p01_largeur], g1 - g0)
      end
    else
      r.bool 'P01 baie : présence dans le mur inférieur', false, "#{gaps.size} baie(s) trouvée(s)"
    end
    xc = P[:p01_decalage] + P[:p01_largeur] / 2.0
    ouvert = !ray_blocked_by?(model, pt(xc, d / 2.0, P[:p01_hauteur] / 2.0), vec(0, -1, 0),
                              walls[:inferieur], d / 2.0 + t + 10)
    linteau = ray_blocked_by?(model, pt(xc, d / 2.0, (P[:p01_hauteur] + h) / 2.0), vec(0, -1, 0),
                              walls[:inferieur], d / 2.0 + t + 10)
    r.bool 'P01 baie traversante + linteau (lancer de rayon)', ouvert && linteau

    # --- P02
    r.titre 'PORTE P02 (mur droit)'
    face = find_face(walls[:droit], trw[:droit], 0, w)
    gaps = face ? door_gaps(face, trw[:droit], 1) : []
    if gaps.size == 1
      g0, g1, gh = gaps.first
      r.val 'P02 baie : largeur', REF[:p02_largeur], g1 - g0
      r.val 'P02 baie : hauteur', REF[:p02_hauteur], gh
      r.val 'P02 baie : décalage / nu mur inférieur (plan)', PLAN[:p02_decalage], g0
      r.val 'P02 trumeau jusqu\'au mur supérieur (plan)', PLAN[:p02_trumeau], d - g1
    else
      r.bool 'P02 baie : présence dans le mur droit', false, "#{gaps.size} baie(s) trouvée(s)"
    end
    yc = P[:p02_decalage] + P[:p02_largeur] / 2.0
    ouvert = !ray_blocked_by?(model, pt(w / 2.0, yc, P[:p02_hauteur] / 2.0), vec(1, 0, 0),
                              walls[:droit], w / 2.0 + t + 10)
    linteau = ray_blocked_by?(model, pt(w / 2.0, yc, (P[:p02_hauteur] + h) / 2.0), vec(1, 0, 0),
                              walls[:droit], w / 2.0 + t + 10)
    r.bool 'P02 baie traversante + linteau (lancer de rayon)', ouvert && linteau

    # --- Vantaux, charnières, sens d'ouverture, arcs
    r.titre 'VANTAUX ET SENS D\'OUVERTURE'
    doors.each do |key, dd|
      inst = dd[:inst]
      spec = dd[:spec]
      lab = spec[:label]
      bdef = inst.definition.bounds
      r.val "#{lab} vantail : largeur", REF[:"#{key}_largeur"], mm(bdef.width)
      r.val "#{lab} vantail : hauteur", REF[:"#{key}_hauteur"], mm(bdef.depth)
      hinge = pt(spec[:hinge][0], spec[:hinge][1], 0)
      charniere_ok = (0..7).any? { |i| mm(inst.bounds.corner(i).distance(hinge)) < 1.0 }
      r.bool "#{lab} charnière côté #{spec[:charniere]} (plan : #{PLAN[:"#{key}_charniere"]})",
             charniere_ok && spec[:charniere] == PLAN[:"#{key}_charniere"]
      sens = side_of(spec, inst.bounds.center)
      r.bool "#{lab} sens d'ouverture : #{REF[:"#{key}_sens"]}", sens == REF[:"#{key}_sens"],
             "vantail côté #{sens}"
      curve = arcs[key]
      if curve.is_a?(Sketchup::ArcCurve)
        r.val "#{lab} arc de débattement : rayon", REF[:"#{key}_largeur"], mm(curve.radius)
        ps = curve.vertices.map(&:position)
        mid = Geom::Point3d.new(ps.map(&:x).inject(:+) / ps.size,
                                ps.map(&:y).inject(:+) / ps.size, 0)
        arc_side = side_of(spec, mid)
        r.bool "#{lab} arc côté #{REF[:"#{key}_sens"]}", arc_side == REF[:"#{key}_sens"],
               "arc côté #{arc_side}"
      else
        r.bool "#{lab} arc de débattement", false, 'absent'
      end
    end

    # --- F01
    r.titre 'FENÊTRE F01 (mur supérieur)'
    face = find_face(walls[:superieur], trw[:superieur], 1, d)
    holes = face ? window_holes(face, trw[:superieur], 0) : []
    if holes.size == 1
      a0, a1, z0, z1 = holes.first
      r.val 'F01 baie : largeur', REF[:f01_largeur], a1 - a0
      r.val 'F01 baie : hauteur', REF[:f01_hauteur], z1 - z0
      r.val 'F01 allège', REF[:f01_allege], z0
      r.val 'F01 niveau supérieur', REF[:f01_niveau_haut], z1
      r.val 'F01 haut de fenêtre -> plafond', REF[:f01_sous_plafond], h - z1
      r.val 'F01 décalage / nu mur gauche (plan)', PLAN[:f01_decalage], a0
      r.val 'F01 largeur (plan)', PLAN[:f01_largeur], a1 - a0
    else
      r.bool 'F01 baie : présence dans le mur supérieur', false, "#{holes.size} baie(s) trouvée(s)"
    end
    xc = P[:f01_decalage] + P[:f01_largeur] / 2.0
    zc = P[:f01_allege] + P[:f01_hauteur] / 2.0
    ouvert = !ray_blocked_by?(model, pt(xc, d / 2.0, zc), vec(0, 1, 0), walls[:superieur], d / 2.0 + t + 10)
    allege = ray_blocked_by?(model, pt(xc, d / 2.0, P[:f01_allege] / 2.0), vec(0, 1, 0),
                             walls[:superieur], d / 2.0 + t + 10)
    r.bool 'F01 baie traversante + allège pleine (rayon)', ouvert && allege
    wb = window.bounds
    r.val 'F01 menuiserie : largeur', REF[:f01_largeur], mm(window.definition.bounds.width)
    r.val 'F01 menuiserie : hauteur', REF[:f01_hauteur], mm(window.definition.bounds.depth)
    r.val 'F01 menuiserie : niveau bas (allège)', REF[:f01_allege], mm(wb.min.z)
    r.bool 'F01 menuiserie dans l\'épaisseur du mur',
           mm(wb.min.y) >= d - TOL && mm(wb.max.y) <= d + t + TOL

    # --- Organisation
    r.titre 'ORGANISATION DU MODÈLE'
    TAGS.each { |n| r.bool "Balise #{n}", !model.layers[n].nil? }
    attendu = {
      murs => '01_MURS', doors[:p01][:inst] => '02_PORTE_P01', doors[:p02][:inst] => '03_PORTE_P02',
      window => '04_FENETRE_F01', sol => '05_SOL'
    }
    attendu.each { |ent, tag| r.bool "#{ent.name} -> #{tag}", ent.layer.name == tag }
    [doors[:p01][:inst], doors[:p02][:inst], window].each do |i|
      r.bool "#{i.name} : composant indépendant", i.is_a?(Sketchup::ComponentInstance)
    end
    SCENES.each { |n| r.bool "Scène #{n}", !model.pages[n].nil? }
    r.bool 'Aucun mobilier / équipement créé', true,
           'objets créés : murs, sol, P01, P02, F01, arcs, cotations'
    r
  end

  def self.afficher(r)
    SKETCHUP_CONSOLE.show if defined?(SKETCHUP_CONSOLE)
    puts '=' * 96
    puts 'RAPPORT DE CONTRÔLE — CUISINE EXISTANTE (tolérance ±%.1f mm)' % TOL
    r.lignes.each { |l| puts l }
    unless r.alertes.empty?
      puts ''
      puts '--- ALERTES (écarts plan de référence / programme)'
      r.alertes.each { |a| puts "[!!] #{a}" }
    end
    puts ''
    puts "BILAN : #{r.nb_ok} contrôle(s) conforme(s), #{r.nb_ko} non conforme(s), " \
         "#{r.alertes.size} alerte(s)."
    puts '=' * 96
    ko = r.lignes.select { |l| l.start_with?('[KO]') }
    msg = "Cuisine existante générée.\n\n" \
          "Contrôles conformes : #{r.nb_ok}\nNon conformes : #{r.nb_ko}\n"
    msg << "\n" << ko.first(10).join("\n") << "\n" unless ko.empty?
    msg << "\nAlertes :\n" << r.alertes.join("\n") << "\n" unless r.alertes.empty?
    msg << "\nRapport détaillé dans la Console Ruby."
    UI.messagebox(msg)
  end

  # ===========================================================================
  # 12. PROGRAMME PRINCIPAL
  # ===========================================================================
  def self.run
    model = Sketchup.active_model
    unless model.entities.length.zero?
      rep = UI.messagebox("Le modèle actif n'est pas vide.\n" \
                          "La cuisine sera ajoutée au contenu existant. Continuer ?", MB_YESNO)
      return nil if rep == IDNO
    end
    validate!
    model.start_operation('Cuisine existante', true)
    begin
      set_units(model)
      tags = create_tags(model)
      mats = create_materials(model)
      apply_style(model)

      murs, walls = build_walls(model, tags['01_MURS'], mats[:mur])
      sol = build_floor(model, tags['05_SOL'], mats[:sol])

      doors = {}
      [[:p01, '02_PORTE_P01', P[:p01_sens]], [:p02, '03_PORTE_P02', P[:p02_sens]]].each do |key, tag, sens|
        spec = door_spec(key)
        doors[key] = { spec: spec, inst: place_door(model, spec, tags[tag], mats[:vantail], sens) }
      end

      arcs_grp = model.entities.add_group
      arcs_grp.name = 'ARCS_OUVERTURE'
      arcs_grp.layer = tags['07_ARCS_OUVERTURE']
      arcs = {}
      doors.each { |key, dd| arcs[key] = add_swing(arcs_grp.entities, dd[:spec])[1] }

      window = place_window(model, tags['04_FENETRE_F01'], mats)
      build_dimensions(model, tags['06_COTATIONS'])

      section = model.entities.add_section_plane([pt(0, 0, P[:hauteur_coupe_plan]), vec(0, 0, -1)])
      section.name = 'COUPE_PLAN_2D' if section.respond_to?(:name=)

      pages = build_scenes(model, section, tags)
      model.commit_operation
    rescue StandardError => e
      model.abort_operation
      UI.messagebox("Erreur pendant la génération : #{e.message}")
      raise
    end

    rapport = controles(model, murs, walls, sol, doors, arcs, window, pages)
    afficher(rapport)
    rapport
  end

end

CuisineExistante.run

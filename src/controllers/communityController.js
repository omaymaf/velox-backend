const Post = require('../models/Post');
const Ride = require('../models/Ride');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const serialize = (post, userId) => {
  const a = post.author || {};
  return {
    id: String(post._id),
    handle: `@${a.username || 'unknown'}`,
    badge: `LVL ${a.level || 1}`,
    title: post.title,
    avatarUrl: a.avatarUrl || '',
    avatarAlt: `Avatar de ${a.username || 'utilisateur'}`,
    kudos: post.kudosBy.length,
    liked: userId ? post.kudosBy.some((id) => String(id) === String(userId)) : false,
    distanceKm: post.distanceKm,
    elevationM: post.elevationM,
    thirdMetricLabel: post.thirdMetricLabel,
    thirdMetricValue: post.thirdMetricValue,
    thirdMetricUnit: post.thirdMetricUnit,
    footerIcon: post.footerIcon,
    footerText: post.footerText,
    accentColor: post.accentColor,
    category: post.category,
    createdAt: post.createdAt,
  };
};

exports.feed = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const posts = await Post.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('author', 'username level avatarUrl');

  res.json({ success: true, routes: posts.map((p) => serialize(p, req.user._id)) });
});

exports.create = asyncHandler(async (req, res) => {
  const { rideId, title, category } = req.body;
  const data = { author: req.user._id, title, category: category || 'Trending', kudosBy: [req.user._id] };

  if (rideId) {
    const ride = await Ride.findOne({ _id: rideId, user: req.user._id });
    if (!ride) throw new ApiError(404, 'Sortie introuvable');
    Object.assign(data, {
      ride: ride._id,
      distanceKm: ride.distanceKm,
      elevationM: ride.elevationM,
      thirdMetricLabel: 'Avg Speed',
      thirdMetricValue: String(ride.avgSpeedKmh),
      thirdMetricUnit: 'KM/H',
      footerText: ride.isPersonalBest ? 'Just completed • Personal Best Beaten!' : 'Just completed',
    });
  }

  const post = await Post.create(data);
  await post.populate('author', 'username level avatarUrl');
  res.status(201).json({ success: true, route: serialize(post, req.user._id) });
});

// Toggle kudos : un clic ajoute, un second clic retire
exports.toggleKudos = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).populate('author', 'username level avatarUrl');
  if (!post) throw new ApiError(404, 'Publication introuvable');

  const uid = String(req.user._id);
  const idx = post.kudosBy.findIndex((id) => String(id) === uid);
  if (idx === -1) post.kudosBy.push(req.user._id);
  else post.kudosBy.splice(idx, 1);
  await post.save();

  res.json({ success: true, route: serialize(post, req.user._id) });
});

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

// Simple list of movie IDs to process
const MOVIE_IDS = [
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23460',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34573',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89016',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23460',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89017',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78906',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23461',
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23461',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90128',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78907',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89017',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45682',
  'a5b6c7d8-e9f0-4123-a5b6-c7d8e9f01240',
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89017',
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45683',
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12349',
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12350',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34571',
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90127',
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67895',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45684',
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45683',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56793',
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78905',
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90128',
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12350',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34572',
  'd4e5f6a7-b8c9-4012-d4e5-f6a7b8c90129',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34571',
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56795',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01239',
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23460',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56794',
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78906',
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78906',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89018',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56794',
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23459',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56789',
  '536c18a0-f16a-49e3-b599-4d0e5b0ca028',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78903',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78905',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34569',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56792',
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12345',
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12346',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01237',
  'f970cb51-a0e1-431f-9e95-cbbfdad2f423',
  '2e7d2849-12d1-4905-ac26-05528caf4e54',
  '0b90620e-2811-4ce9-b201-932953a7e707',
  '33c61a81-bd4b-4614-a37c-a48ad846a943',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45681',
  'fc856d32-7ddd-49d0-8dc4-72daf5cfd56a',
  'd291ffc8-1bd1-48d2-9fda-addd36e7519c',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90124',
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12345',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89013',
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90124',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89014',
  'cf0c389c-6d66-4319-ab85-fcf161c8e005',
  'd6706193-7db8-4b31-aec1-40fd72288731',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01236',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56792',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01234',
  '43ef52c6-3e09-4e5c-a104-f9a796e66e4d',
  'c1d107ec-8f25-4d8b-8f73-04cdc51cc629',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90123',
  'd36094b3-f4ee-4fbe-b5c7-47b69d5ea995',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01235',
  '3738b1fd-9afc-496f-940f-0d55165fd22e',
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78903',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56791',
  'c1d2e3f4-a5b6-4789-c1d2-e3f4a5b67891',
  'd6e7f8a9-b0c1-4234-d6e7-f8a9b0c12345',
  'a5b6c7d8-e9f0-4123-a5b6-c7d8e9f01236',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23458',
  'adac7718-076e-49a0-81d5-d4db76e18eed',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90125',
  'edc7c965-5141-4582-ab40-156e4ebd0acb',
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12349',
  'a7b8c9d0-e1f2-4345-a7b8-c9d0e1f23459',
  'd8e9f0a1-b2c3-4456-d8e9-f0a1b2c34568',
  'eb1c72c7-fa72-4e59-886c-d8726ab0088c',
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23458',
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45679',
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56792',
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45678',
  'e3f4a5b6-c7d8-4901-e3f4-a5b6c7d89014',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34570',
  '922d262c-594a-44b2-8522-205583753652',
  'a3b4c5d6-e7f8-4901-a3b4-c5d6e7f89013',
  'f8a9b0c1-d2e3-4456-f8a9-b0c1d2e34568',
  'e9f0a1b2-c3d4-4567-e9f0-a1b2c3d45680',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89015',
  '3be70b05-6a87-4477-821c-b6931c9c8d87',
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01234',
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78904',
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01237',
  'b8c9d0e1-f2a3-4456-b8c9-d0e1f2a34570',
  'e5f6a7b8-c9d0-4123-e5f6-a7b8c9d01238',
  'b2c3d4e5-f6a7-4890-b2c3-d4e5f6a78901',
  'f2a3b4c5-d6e7-4890-f2a3-b4c5d6e78903',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56793',
  '3c7a52c4-daf5-4717-9fa4-944ddb7f05cc',
  'b0c1d2e3-f4a5-4678-b0c1-d2e3f4a56790',
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12346',
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45680',
  'e7f8a9b0-c1d2-4345-e7f8-a9b0c1d23458',
  'e1f2a3b4-c5d6-4789-e1f2-a3b4c5d67892',
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01236',
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78902',
  '41e41ab1-2740-4f0f-8ba7-502307cf2e6d',
  'd0e1f2a3-b4c5-4678-d0e1-f2a3b4c56790',
  'd2e3f4a5-b6c7-4890-d2e3-f4a5b6c78904',
  'f0a1b2c3-d4e5-4678-f0a1-b2c3d4e56790',
  'bc786e12-ddab-43f5-a630-158223c3feca',
  '35fe61cd-1633-4bcd-961a-ea3c5c1d88ec',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90127',
  'c3d4e5f6-a7b8-4901-c3d4-e5f6a7b89016',
  'b6c7d8e9-f0a1-4234-b6c7-d8e9f0a12348',
  'f6a7b8c9-d0e1-4234-f6a7-b8c9d0e12347',
  '89542279-70ca-4873-861a-3d6a9f878248',
  'f4a5b6c7-d8e9-4012-f4a5-b6c7d8e90125',
  'b4c5d6e7-f8a9-4012-b4c5-d6e7f8a90126',
  'c7d8e9f0-a1b2-4345-c7d8-e9f0a1b23457',
  'a9b0c1d2-e3f4-4567-a9b0-c1d2e3f45679',
  'c5d6e7f8-a9b0-4123-c5d6-e7f8a9b01235',
  'ae625a75-6a79-4d5f-91d0-44b5d4dd7343',
  'c9d0e1f2-a3b4-4567-c9d0-e1f2a3b45681',
  'c4784d69-2aa3-4818-af90-fefc8960397a'
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

async function analyzeMovie(movieId) {
  console.log(`\n🎬 Processing movie ID: ${movieId}`);
  
  // Get movie and subtitles
  const { data: movie } = await supabase
    .from('movies')
    .select('*')
    .eq('id', movieId)
    .single();
    
  if (!movie || !movie.subtitles) {
    console.log(`❌ No subtitles for movie ${movieId}`);
    return;
  }

  console.log(`📝 Analyzing: ${movie.title}`);
  
  // Call Claude
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: `Analyze these movie subtitles for toddlers aged 2-5. Create age-appropriate scene descriptions for 24m, 36m, 48m, and 60m developmental stages.

Movie: ${movie.title}
Subtitles: ${movie.subtitles.substring(0, 50000)}

Return JSON with scenes array containing: timestamp_start, timestamp_end, description, age_flags (object with 24m/36m/48m/60m booleans), intensity (1-5), tags (array).`
    }]
  });

  // Parse and save scenes
  try {
    const scenes = JSON.parse(response.content[0].text).scenes;
    
    for (const scene of scenes) {
      await supabase.from('scenes').insert({
        movie_id: movieId,
        timestamp_start: scene.timestamp_start,
        timestamp_end: scene.timestamp_end,
        description: scene.description,
        age_flags: scene.age_flags,
        intensity: scene.intensity,
        tags: scene.tags
      });
    }
    
    console.log(`✅ Saved ${scenes.length} scenes for ${movie.title}`);
  } catch (error) {
    console.log(`❌ Failed to parse/save scenes: ${error.message}`);
  }
  
  // Wait 90 seconds
  console.log('⏳ Waiting 90 seconds...');
  await new Promise(resolve => setTimeout(resolve, 90000));
}

async function main() {
  console.log(`🚀 Processing ${MOVIE_IDS.length} movies...`);
  
  for (const movieId of MOVIE_IDS) {
    await analyzeMovie(movieId);
  }
  
  console.log('🎉 Done!');
}

main().catch(console.error); 